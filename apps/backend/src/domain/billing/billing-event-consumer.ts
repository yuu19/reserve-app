import type {
  BillingApiInvoiceEvent,
  BillingApiInvoiceEventsResponse,
  BillingApiSummaryResponse,
  BillingSubjectChangedEvent,
  BillingSubjectChangedReason,
} from '@repo/billing-types';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import { resolveBillingApiClient } from '../../features/billing/billing-api-client.js';
import * as dbSchema from '../../infra/db/schema.js';
import { sendReserveAppPaymentIssueNotification } from './reserve-app-billing-notifications.js';

type BillingEventOutcome =
  | 'applied'
  | 'duplicate'
  | 'suppressed_disabled'
  | 'suppressed_recovered'
  | 'notification_sent'
  | 'notification_not_required'
  | 'terminal_failure';

type BillingEventProcessResult =
  | { action: 'ack'; outcome: BillingEventOutcome }
  | { action: 'retry'; delaySeconds: number; reason: string };

const BILLING_EVENT_PROCESSING_LEASE_MS = 5 * 60 * 1000;

export type BillingEventMessageBatch = {
  messages: readonly {
    body: unknown;
    attempts: number;
    ack(): void;
    retry(options?: { delaySeconds?: number }): void;
  }[];
};

const paymentIssueReasons = new Set([
  'stripe.invoice.payment_failed',
  'stripe.invoice.payment_action_required',
]);

const billingSubjectChangedReasons = new Set<BillingSubjectChangedReason>([
  'stripe.checkout.session.completed',
  'stripe.customer.subscription.created',
  'stripe.customer.subscription.updated',
  'stripe.customer.subscription.deleted',
  'stripe.subscription_schedule.created',
  'stripe.subscription_schedule.updated',
  'stripe.subscription_schedule.released',
  'stripe.subscription_schedule.completed',
  'stripe.invoice.finalized',
  'stripe.invoice.paid',
  'stripe.invoice.payment_succeeded',
  'stripe.invoice.payment_failed',
  'stripe.invoice.payment_action_required',
  'command.trial.started',
  'command.trial.completed',
  'command.addon.updated',
]);

const affectedResourceNames = new Set([
  'account',
  'subscription',
  'entitlements',
  'invoice',
  'addons',
]);

const isNullableString = (value: unknown): boolean => value === null || typeof value === 'string';

const readRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const isBillingSubjectChangedEvent = (
  value: unknown,
): value is BillingSubjectChangedEvent => {
  const event = readRecord(value);
  const subject = readRecord(event.subject);
  const provider = readRecord(event.provider);
  const invoiceEvent = event.invoiceEvent === null ? null : readRecord(event.invoiceEvent);
  const invoiceEventValid =
    invoiceEvent === null ||
    (typeof invoiceEvent.id === 'string' &&
      (invoiceEvent.type === 'invoice_available' ||
        invoiceEvent.type === 'payment_succeeded' ||
        invoiceEvent.type === 'payment_failed' ||
        invoiceEvent.type === 'payment_action_required') &&
      isNullableString(invoiceEvent.providerInvoiceId) &&
      isNullableString(invoiceEvent.providerPaymentIntentId) &&
      isNullableString(invoiceEvent.providerStatus) &&
      isNullableString(invoiceEvent.occurredAt));
  return (
    event.schemaVersion === 1 &&
    typeof event.eventId === 'string' &&
    event.eventType === 'billing.subject.changed.v1' &&
    typeof event.appId === 'string' &&
    typeof subject.type === 'string' &&
    typeof subject.id === 'string' &&
    Number.isInteger(subject.revision) &&
    Number(subject.revision) > 0 &&
    typeof event.reason === 'string' &&
    billingSubjectChangedReasons.has(event.reason as BillingSubjectChangedReason) &&
    Array.isArray(event.affectedResources) &&
    event.affectedResources.every(
      (resource) => typeof resource === 'string' && affectedResourceNames.has(resource),
    ) &&
    typeof event.occurredAt === 'string' &&
    !Number.isNaN(Date.parse(event.occurredAt)) &&
    provider.name === 'stripe' &&
    isNullableString(provider.eventId) &&
    isNullableString(provider.customerId) &&
    isNullableString(provider.subscriptionId) &&
    invoiceEventValid
  );
};

const isProblemSubscriptionStatus = (summary: BillingApiSummaryResponse): boolean =>
  summary.subscription?.status === 'past_due' ||
  summary.subscription?.status === 'unpaid' ||
  summary.subscription?.status === 'incomplete';

const eventTime = (event: BillingApiInvoiceEvent): number => {
  const value = event.occurredAt ?? event.createdAt;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const isInvoicePaymentRecovered = ({
  event,
  invoiceEvents,
}: {
  event: BillingSubjectChangedEvent;
  invoiceEvents: BillingApiInvoiceEventsResponse;
}): boolean => {
  const providerInvoiceId = event.invoiceEvent?.providerInvoiceId;
  if (!providerInvoiceId) {
    return false;
  }
  const issueTime = Date.parse(event.invoiceEvent?.occurredAt ?? event.occurredAt);
  return invoiceEvents.events.some(
    (candidate) =>
      candidate.providerInvoiceId === providerInvoiceId &&
      (candidate.eventType === 'payment_succeeded' ||
        (candidate.eventType === 'invoice_available' && candidate.providerStatus === 'paid')) &&
      eventTime(candidate) >= (Number.isNaN(issueTime) ? 0 : issueTime),
  );
};

const retryDelaySeconds = (attempts: number): number =>
  Math.min(12 * 60 * 60, 30 * 2 ** Math.max(0, attempts - 1));

export const isBillingEventProcessingLeaseExpired = ({
  leaseExpiresAt,
  timestamp,
}: {
  leaseExpiresAt: Date | null;
  timestamp: Date;
}): boolean => leaseExpiresAt === null || leaseExpiresAt.getTime() <= timestamp.getTime();

const processingLeaseRetryDelaySeconds = ({
  leaseExpiresAt,
  timestamp,
  attempts,
}: {
  leaseExpiresAt: Date | null;
  timestamp: Date;
  attempts: number;
}): number => {
  if (!leaseExpiresAt) {
    return 1;
  }
  return Math.max(
    1,
    Math.min(
      retryDelaySeconds(attempts),
      Math.ceil((leaseExpiresAt.getTime() - timestamp.getTime()) / 1000),
    ),
  );
};

const insertReceivedInbox = async ({
  database,
  event,
}: {
  database: AuthRuntimeDatabase;
  event: BillingSubjectChangedEvent;
}) => {
  const timestamp = new Date();
  await database
    .insert(dbSchema.billingEventInbox)
    .values({
      id: crypto.randomUUID(),
      eventId: event.eventId,
      schemaVersion: event.schemaVersion,
      appId: event.appId,
      subjectType: event.subject.type,
      subjectId: event.subject.id,
      revision: event.subject.revision,
      reason: event.reason,
      payloadJson: JSON.stringify(event),
      processingStatus: 'received',
      attemptCount: 0,
      receivedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing();
};

const recordInvalidBillingEvent = async ({
  database,
  body,
}: {
  database: AuthRuntimeDatabase;
  body: unknown;
}) => {
  const record = readRecord(body);
  const eventId =
    typeof record.eventId === 'string' && record.eventId.length > 0
      ? record.eventId
      : `invalid_${crypto.randomUUID()}`;
  const timestamp = new Date();
  await database
    .insert(dbSchema.billingEventInbox)
    .values({
      id: crypto.randomUUID(),
      eventId,
      schemaVersion: 0,
      appId: 'invalid',
      subjectType: 'invalid',
      subjectId: eventId,
      revision: 0,
      reason: 'invalid_payload',
      payloadJson: '{"invalid":true}',
      processingStatus: 'terminal_failed',
      outcome: 'terminal_failure',
      attemptCount: 1,
      lastError: 'invalid_billing_event_payload',
      receivedAt: timestamp,
      processedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing();
};

const advanceCursor = async ({
  database,
  event,
}: {
  database: AuthRuntimeDatabase;
  event: BillingSubjectChangedEvent;
}) => {
  const timestamp = new Date();
  await database
    .insert(dbSchema.billingEventConsumerCursor)
    .values({
      id: crypto.randomUUID(),
      appId: event.appId,
      subjectType: event.subject.type,
      subjectId: event.subject.id,
      lastRevision: event.subject.revision,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [
        dbSchema.billingEventConsumerCursor.appId,
        dbSchema.billingEventConsumerCursor.subjectType,
        dbSchema.billingEventConsumerCursor.subjectId,
      ],
      set: {
        lastRevision: sql`max(${dbSchema.billingEventConsumerCursor.lastRevision}, ${event.subject.revision})`,
        updatedAt: timestamp,
      },
    });
};

const finalizeEvent = async ({
  database,
  event,
  leaseToken,
  status,
  outcome,
  lastError = null,
}: {
  database: AuthRuntimeDatabase;
  event: BillingSubjectChangedEvent;
  leaseToken: string;
  status: 'succeeded' | 'suppressed' | 'terminal_failed';
  outcome: BillingEventOutcome;
  lastError?: string | null;
}) => {
  const timestamp = new Date();
  const finalized = await database
    .update(dbSchema.billingEventInbox)
    .set({
      processingStatus: status,
      outcome,
      lastError,
      leaseToken: null,
      leaseExpiresAt: null,
      processedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(dbSchema.billingEventInbox.eventId, event.eventId),
        eq(dbSchema.billingEventInbox.processingStatus, 'processing'),
        eq(dbSchema.billingEventInbox.leaseToken, leaseToken),
      ),
    )
    .returning({ id: dbSchema.billingEventInbox.id });
  if (!finalized[0]) {
    throw new Error('BILLING_EVENT_PROCESSING_LEASE_LOST');
  }
  await advanceCursor({ database, event });
};

const markRetryableFailure = async ({
  database,
  eventId,
  leaseToken,
  reason,
}: {
  database: AuthRuntimeDatabase;
  eventId: string;
  leaseToken: string;
  reason: string;
}) => {
  const released = await database
    .update(dbSchema.billingEventInbox)
    .set({
      processingStatus: 'retryable_failed',
      lastError: reason.slice(0, 500),
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dbSchema.billingEventInbox.eventId, eventId),
        eq(dbSchema.billingEventInbox.processingStatus, 'processing'),
        eq(dbSchema.billingEventInbox.leaseToken, leaseToken),
      ),
    )
    .returning({ id: dbSchema.billingEventInbox.id });
  return Boolean(released[0]);
};

const processPaymentIssue = async ({
  database,
  env,
  event,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  event: BillingSubjectChangedEvent;
}): Promise<
  | { kind: 'success'; status: 'succeeded' | 'suppressed'; outcome: BillingEventOutcome }
  | { kind: 'retry'; reason: string }
  | { kind: 'terminal'; reason: string }
> => {
  const resolution = resolveBillingApiClient({ env, enabled: true });
  if (!resolution.enabled) {
    return { kind: 'retry', reason: `billing_api_${resolution.disabledReason}` };
  }
  let summary: BillingApiSummaryResponse;
  let invoiceEvents: BillingApiInvoiceEventsResponse;
  try {
    [summary, invoiceEvents] = await Promise.all([
      resolution.client.readSummary({
        subjectType: event.subject.type,
        subjectId: event.subject.id,
      }),
      resolution.client.readInvoiceEvents(
        {
          subjectType: event.subject.type,
          subjectId: event.subject.id,
        },
        { limit: 100 },
      ),
    ]);
  } catch (error) {
    return {
      kind: 'retry',
      reason: error instanceof Error ? error.message : 'billing_api_read_failed',
    };
  }
  if (
    !isProblemSubscriptionStatus(summary) ||
    isInvoicePaymentRecovered({ event, invoiceEvents })
  ) {
    return { kind: 'success', status: 'suppressed', outcome: 'suppressed_recovered' };
  }
  if (env.BILLING_EVENT_NOTIFICATIONS_ENABLED !== 'true') {
    return { kind: 'success', status: 'suppressed', outcome: 'suppressed_disabled' };
  }
  if (!event.provider.eventId || !event.invoiceEvent) {
    return { kind: 'terminal', reason: 'payment_issue_identifiers_missing' };
  }
  const notification = await sendReserveAppPaymentIssueNotification({
    database,
    env,
    organizationId: event.subject.id,
    notificationKind:
      event.reason === 'stripe.invoice.payment_action_required'
        ? 'payment_action_required_email'
        : 'payment_failed_email',
    stripeEventId: event.provider.eventId,
    stripeCustomerId: event.provider.customerId,
    stripeSubscriptionId: event.provider.subscriptionId,
    stripeInvoiceId: event.invoiceEvent.providerInvoiceId,
  });
  if (notification.ok) {
    return {
      kind: 'success',
      status: 'succeeded',
      outcome: notification.notificationSent ? 'notification_sent' : 'notification_not_required',
    };
  }
  return notification.retryable
    ? { kind: 'retry', reason: notification.failureReason }
    : { kind: 'terminal', reason: notification.failureReason };
};

const finalInboxStatuses = new Set(['succeeded', 'suppressed', 'terminal_failed']);

const readStoredOutcome = (value: string | null): BillingEventOutcome =>
  value === 'applied' ||
  value === 'suppressed_disabled' ||
  value === 'suppressed_recovered' ||
  value === 'notification_sent' ||
  value === 'notification_not_required' ||
  value === 'terminal_failure'
    ? value
    : 'duplicate';

export const processBillingSubjectChangedEvent = async ({
  database,
  env,
  event,
  attempts,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  event: BillingSubjectChangedEvent;
  attempts: number;
}): Promise<BillingEventProcessResult> => {
  await insertReceivedInbox({ database, event });
  const [cursorRows, inboxRows] = await Promise.all([
    database
      .select()
      .from(dbSchema.billingEventConsumerCursor)
      .where(
        and(
          eq(dbSchema.billingEventConsumerCursor.appId, event.appId),
          eq(dbSchema.billingEventConsumerCursor.subjectType, event.subject.type),
          eq(dbSchema.billingEventConsumerCursor.subjectId, event.subject.id),
        ),
      )
      .limit(1),
    database
      .select()
      .from(dbSchema.billingEventInbox)
      .where(eq(dbSchema.billingEventInbox.eventId, event.eventId))
      .limit(1),
  ]);
  const cursor = cursorRows[0]?.lastRevision ?? 0;
  const inbox = inboxRows[0];
  if (event.subject.revision <= cursor) {
    return { action: 'ack', outcome: 'duplicate' };
  }
  if (event.subject.revision > cursor + 1) {
    return {
      action: 'retry',
      delaySeconds: retryDelaySeconds(attempts),
      reason: `revision_gap_expected_${cursor + 1}`,
    };
  }
  if (inbox && finalInboxStatuses.has(inbox.processingStatus)) {
    await advanceCursor({ database, event });
    return { action: 'ack', outcome: readStoredOutcome(inbox.outcome) };
  }
  const claimTimestamp = new Date();
  if (
    inbox?.processingStatus === 'processing' &&
    !isBillingEventProcessingLeaseExpired({
      leaseExpiresAt: inbox.leaseExpiresAt,
      timestamp: claimTimestamp,
    })
  ) {
    return {
      action: 'retry',
      delaySeconds: processingLeaseRetryDelaySeconds({
        leaseExpiresAt: inbox.leaseExpiresAt,
        timestamp: claimTimestamp,
        attempts,
      }),
      reason: 'event_already_processing',
    };
  }
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(claimTimestamp.getTime() + BILLING_EVENT_PROCESSING_LEASE_MS);
  const claimed = await database
    .update(dbSchema.billingEventInbox)
    .set({
      processingStatus: 'processing',
      attemptCount: (inbox?.attemptCount ?? 0) + 1,
      lastError: null,
      leaseToken,
      leaseExpiresAt,
      updatedAt: claimTimestamp,
    })
    .where(
      and(
        eq(dbSchema.billingEventInbox.eventId, event.eventId),
        or(
          inArray(dbSchema.billingEventInbox.processingStatus, ['received', 'retryable_failed']),
          and(
            eq(dbSchema.billingEventInbox.processingStatus, 'processing'),
            or(
              isNull(dbSchema.billingEventInbox.leaseExpiresAt),
              lt(dbSchema.billingEventInbox.leaseExpiresAt, claimTimestamp),
            ),
          ),
        ),
      ),
    )
    .returning({ id: dbSchema.billingEventInbox.id });
  if (!claimed[0]) {
    return {
      action: 'retry',
      delaySeconds: retryDelaySeconds(attempts),
      reason: 'event_claim_conflict',
    };
  }
  try {
    if (event.appId !== 'reserve' || event.subject.type !== 'organization') {
      await finalizeEvent({
        database,
        event,
        leaseToken,
        status: 'terminal_failed',
        outcome: 'terminal_failure',
        lastError: 'unsupported_billing_subject',
      });
      return { action: 'ack', outcome: 'terminal_failure' };
    }
    if (!paymentIssueReasons.has(event.reason)) {
      await finalizeEvent({
        database,
        event,
        leaseToken,
        status: 'succeeded',
        outcome: 'applied',
      });
      return { action: 'ack', outcome: 'applied' };
    }
    const result = await processPaymentIssue({ database, env, event });
    if (result.kind === 'retry') {
      const released = await markRetryableFailure({
        database,
        eventId: event.eventId,
        leaseToken,
        reason: result.reason,
      });
      return {
        action: 'retry',
        delaySeconds: retryDelaySeconds(attempts),
        reason: released ? result.reason : 'event_processing_lease_lost',
      };
    }
    if (result.kind === 'terminal') {
      await finalizeEvent({
        database,
        event,
        leaseToken,
        status: 'terminal_failed',
        outcome: 'terminal_failure',
        lastError: result.reason,
      });
      return { action: 'ack', outcome: 'terminal_failure' };
    }
    await finalizeEvent({
      database,
      event,
      leaseToken,
      status: result.status,
      outcome: result.outcome,
    });
    return { action: 'ack', outcome: result.outcome };
  } catch (error) {
    try {
      await markRetryableFailure({
        database,
        eventId: event.eventId,
        leaseToken,
        reason: error instanceof Error ? error.message : 'billing_event_processing_failed',
      });
    } catch (releaseError) {
      console.error('[billing-event] Failed to release processing lease.', releaseError);
    }
    throw error;
  }
};

export const consumeBillingEventBatch = async ({
  database,
  env,
  batch,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  batch: BillingEventMessageBatch;
}): Promise<void> => {
  const messages = [...batch.messages].sort((left, right) => {
    const leftEvent = isBillingSubjectChangedEvent(left.body) ? left.body : null;
    const rightEvent = isBillingSubjectChangedEvent(right.body) ? right.body : null;
    if (!leftEvent || !rightEvent) {
      return 0;
    }
    const leftKey = `${leftEvent.appId}:${leftEvent.subject.type}:${leftEvent.subject.id}`;
    const rightKey = `${rightEvent.appId}:${rightEvent.subject.type}:${rightEvent.subject.id}`;
    return leftKey === rightKey
      ? leftEvent.subject.revision - rightEvent.subject.revision
      : leftKey.localeCompare(rightKey);
  });
  for (const message of messages) {
    if (!isBillingSubjectChangedEvent(message.body)) {
      console.error('[billing-event] Invalid billing event payload.');
      try {
        await recordInvalidBillingEvent({ database, body: message.body });
      } catch (error) {
        console.error('[billing-event] Failed to record invalid payload.', error);
        message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
        continue;
      }
      message.ack();
      continue;
    }
    try {
      const result = await processBillingSubjectChangedEvent({
        database,
        env,
        event: message.body,
        attempts: message.attempts,
      });
      if (result.action === 'retry') {
        message.retry({ delaySeconds: result.delaySeconds });
      } else {
        message.ack();
      }
    } catch (error) {
      console.error('[billing-event] Consumer failed.', error);
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
    }
  }
};
