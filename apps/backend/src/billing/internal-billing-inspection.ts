import { and, desc, eq, or } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import {
  isBillingInterval,
  isBillingSubscriptionStatus,
  resolveOrganizationBillingPaymentIssueState,
  resolveOrganizationBillingPaymentMethodStatus,
  resolveOrganizationBillingProfileReadiness,
  selectOrganizationBillingSummary,
  type OrganizationBillingPlanState,
  type OrganizationBillingSubscriptionStatus,
} from './organization-billing.js';
import {
  buildBillingDocumentReadiness,
  buildInternalBillingDocumentInspection,
} from './organization-billing-documents.js';
import {
  readOrganizationBillingDocumentReferences,
  readOrganizationBillingInvoicePaymentEvents,
  type OrganizationBillingInvoicePaymentEvent,
} from './organization-billing-invoice-events.js';
import { readRecentBillingOperationAttempts } from './organization-billing-operations.js';
import {
  normalizeOrganizationBillingNotificationDeliveryState,
  readTrialReminderDeliveryAuditInspection,
} from './organization-billing-notifications.js';
import { readInternalBillingReconciliationInspection } from './organization-billing-observability.js';
import { resolveOrganizationPremiumEntitlementPolicy } from './organization-billing-policy.js';

const toIsoDateString = (value: unknown): string | null => {
  const candidate =
    value instanceof Date
      ? value
      : typeof value === 'number' || typeof value === 'string'
        ? new Date(value)
        : null;

  if (!candidate || Number.isNaN(candidate.getTime())) {
    return null;
  }

  return candidate.toISOString();
};

const toLifecycleStage = (
  planState: 'free' | 'premium_trial' | 'premium_paid',
): 'free' | 'trial' | 'paid' => {
  if (planState === 'premium_trial') {
    return 'trial';
  }
  if (planState === 'premium_paid') {
    return 'paid';
  }
  return 'free';
};

const normalizeProviderPlanState = (value: unknown): OrganizationBillingPlanState | null => {
  return value === 'free' || value === 'premium_trial' || value === 'premium_paid' ? value : null;
};

const normalizeProviderSubscriptionStatus = (
  value: unknown,
): OrganizationBillingSubscriptionStatus | null => {
  return typeof value === 'string' ? isBillingSubscriptionStatus(value) : null;
};

const toTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const getPaymentEventTime = (event: OrganizationBillingInvoicePaymentEvent) =>
  toTimestamp(event.occurredAt) ?? toTimestamp(event.createdAt);

const resolveInspectionPaymentIssueState = ({
  subscriptionStatus,
  entitlementReason,
  invoicePaymentEvents,
}: {
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
  entitlementReason: string;
  invoicePaymentEvents: OrganizationBillingInvoicePaymentEvent[];
}) => {
  const latestIssueEvent = invoicePaymentEvents.find(
    (
      event,
    ): event is OrganizationBillingInvoicePaymentEvent & {
      eventType: 'payment_failed' | 'payment_action_required';
    } => event.eventType === 'payment_failed' || event.eventType === 'payment_action_required',
  );
  const latestSucceededEvent = invoicePaymentEvents.find(
    (event) => event.eventType === 'payment_succeeded',
  );
  const issueEventTime = latestIssueEvent ? getPaymentEventTime(latestIssueEvent) : null;
  const latestSucceededTime = latestSucceededEvent
    ? getPaymentEventTime(latestSucceededEvent)
    : null;
  const hasRecoveredPaymentIssueHistory = Boolean(
    latestSucceededEvent &&
    invoicePaymentEvents.some(
      (event) =>
        event.eventType === 'payment_failed' || event.eventType === 'payment_action_required',
    ),
  );
  const hasStaleFailureHistory = Boolean(
    latestIssueEvent &&
    latestSucceededTime !== null &&
    issueEventTime !== null &&
    issueEventTime > latestSucceededTime &&
    (subscriptionStatus === 'active' ||
      subscriptionStatus === 'trialing' ||
      subscriptionStatus === 'free' ||
      subscriptionStatus === 'canceled'),
  );
  const latestPaymentIssueEventType:
    | 'payment_failed'
    | 'payment_action_required'
    | 'payment_succeeded'
    | null =
    latestSucceededEvent &&
    latestSucceededTime !== null &&
    (issueEventTime === null || latestSucceededTime >= issueEventTime)
      ? 'payment_succeeded'
      : (latestIssueEvent?.eventType ?? null);

  return resolveOrganizationBillingPaymentIssueState({
    subscriptionStatus,
    entitlementReason,
    latestPaymentIssueEventType,
    hasRecoveredPaymentIssueHistory,
    hasStaleFailureHistory,
  });
};

const resolveInspectionSummaryPlanState = ({
  planState,
  isPremiumEligible,
}: {
  planState: OrganizationBillingPlanState;
  isPremiumEligible: boolean;
}): OrganizationBillingPlanState => {
  return isPremiumEligible ? planState : 'free';
};

type InternalBillingTimelineLane =
  | 'billing_state'
  | 'reconciliation'
  | 'notification'
  | 'provider_webhook';

type InternalBillingTimelineEntryType =
  | 'audit_event'
  | 'signal'
  | 'notification'
  | 'webhook_event'
  | 'webhook_failure';

type InternalBillingTimelineEntry = {
  id: string;
  lane: InternalBillingTimelineLane;
  entryType: InternalBillingTimelineEntryType;
  occurredAt: string | null;
  headline: string;
  summary: string;
  notificationKind: string | null;
  communicationType: 'trial_will_end' | 'payment_issue' | 'unknown' | null;
  notificationChannel: 'email' | 'in_app' | 'web_push' | 'unknown' | null;
  notificationChannelLabel: string | null;
  sequenceNumber: number | null;
  stripeEventId: string | null;
  sourceKind: string | null;
  signalKind: 'reconciliation' | 'notification_delivery' | null;
  signalStatus: 'pending' | 'mismatch' | 'unavailable' | 'resolved' | null;
  deliveryState: 'requested' | 'retried' | 'sent' | 'failed' | 'skipped' | 'unknown' | null;
  webhookEventType: string | null;
  webhookProcessingStatus: 'processing' | 'processed' | 'failed' | null;
  webhookFailureStage: string | null;
};

const buildInternalBillingInvestigationTimeline = ({
  auditRows,
  reconciliation,
  notifications,
}: {
  auditRows: Array<{
    sequenceNumber: number;
    sourceKind: string;
    sourceContext: string | null;
    stripeEventId: string | null;
    createdAt: unknown;
    previousPlanState: string;
    nextPlanState: string;
    previousSubscriptionStatus: string;
    nextSubscriptionStatus: string;
    previousPaymentMethodStatus: string;
    nextPaymentMethodStatus: string;
  }>;
  reconciliation: {
    recentSignals: Array<{
      sequenceNumber: number;
      signalStatus: 'pending' | 'mismatch' | 'unavailable' | 'resolved';
      sourceKind: string;
      reason: string;
      stripeEventId: string | null;
      createdAt: string | null;
    }>;
    recentWebhookEvents: Array<{
      id: string;
      eventType: string;
      processingStatus: 'processing' | 'processed' | 'failed';
      failureReason: string | null;
      createdAt: string | null;
    }>;
    recentWebhookFailures: Array<{
      eventId: string | null;
      eventType: string | null;
      failureStage: string;
      failureReason: string;
      createdAt: string | null;
    }>;
  };
  notifications: {
    reminderDelivery: {
      history: Array<{
        sequenceNumber: number;
        notificationKind: string;
        communicationType: 'trial_will_end' | 'payment_issue' | 'unknown';
        channel: 'email' | 'in_app' | 'web_push' | 'unknown';
        channelLabel: string;
        deliveryState: 'requested' | 'retried' | 'sent' | 'failed' | 'skipped' | 'unknown';
        deliveryOutcome: 'pending' | 'delivered' | 'failed' | 'unknown';
        stripeEventId: string | null;
        recipientEmail: string | null;
        failureReason: string | null;
        createdAt: string | null;
      }>;
    };
  };
}) => {
  const auditEntries: InternalBillingTimelineEntry[] = auditRows.map((row) => ({
    id: `audit:${row.sequenceNumber}`,
    lane: 'billing_state',
    entryType: 'audit_event',
    occurredAt: toIsoDateString(row.createdAt),
    headline: 'Billing state changed',
    summary:
      `${row.previousPlanState}/${row.previousSubscriptionStatus}/${row.previousPaymentMethodStatus}` +
      ` -> ${row.nextPlanState}/${row.nextSubscriptionStatus}/${row.nextPaymentMethodStatus}`,
    sequenceNumber: row.sequenceNumber,
    stripeEventId: row.stripeEventId ?? null,
    sourceKind: row.sourceKind,
    notificationKind: null,
    communicationType: null,
    notificationChannel: null,
    notificationChannelLabel: null,
    signalKind: null,
    signalStatus: null,
    deliveryState: null,
    webhookEventType: null,
    webhookProcessingStatus: null,
    webhookFailureStage: null,
  }));

  const signalEntries: InternalBillingTimelineEntry[] = reconciliation.recentSignals.map((row) => ({
    id: `signal:reconciliation:${row.sequenceNumber}`,
    lane: 'reconciliation',
    entryType: 'signal',
    occurredAt: row.createdAt,
    headline: `Reconciliation ${row.signalStatus}`,
    summary: row.reason,
    sequenceNumber: row.sequenceNumber,
    stripeEventId: row.stripeEventId,
    sourceKind: row.sourceKind,
    notificationKind: null,
    communicationType: null,
    notificationChannel: null,
    notificationChannelLabel: null,
    signalKind: 'reconciliation',
    signalStatus: row.signalStatus,
    deliveryState: null,
    webhookEventType: null,
    webhookProcessingStatus: null,
    webhookFailureStage: null,
  }));

  const notificationEntries: InternalBillingTimelineEntry[] =
    notifications.reminderDelivery.history.map((row) => ({
      id: `notification:${row.sequenceNumber}`,
      lane: 'notification',
      entryType: 'notification',
      occurredAt: row.createdAt,
      headline: `${row.channelLabel} reminder ${row.deliveryState}`,
      summary: row.failureReason
        ? `${row.channelLabel}: ${row.recipientEmail ?? 'owner'} (${row.failureReason})`
        : `${row.channelLabel}: ${row.recipientEmail ?? 'owner'}`,
      sequenceNumber: row.sequenceNumber,
      stripeEventId: row.stripeEventId,
      sourceKind: row.notificationKind,
      notificationKind: row.notificationKind,
      communicationType: row.communicationType,
      notificationChannel: row.channel,
      notificationChannelLabel: row.channelLabel,
      signalKind: null,
      signalStatus: null,
      deliveryState: row.deliveryState,
      webhookEventType: null,
      webhookProcessingStatus: null,
      webhookFailureStage: null,
    }));

  const webhookEventEntries: InternalBillingTimelineEntry[] =
    reconciliation.recentWebhookEvents.map((row) => ({
      id: `webhook-event:${row.id}`,
      lane: 'provider_webhook',
      entryType: 'webhook_event',
      occurredAt: row.createdAt,
      headline: 'Stripe webhook event',
      summary: row.failureReason
        ? `${row.eventType} (${row.processingStatus}, ${row.failureReason})`
        : `${row.eventType} (${row.processingStatus})`,
      sequenceNumber: null,
      stripeEventId: row.id,
      sourceKind: null,
      notificationKind: null,
      communicationType: null,
      notificationChannel: null,
      notificationChannelLabel: null,
      signalKind: null,
      signalStatus: null,
      deliveryState: null,
      webhookEventType: row.eventType,
      webhookProcessingStatus: row.processingStatus,
      webhookFailureStage: null,
    }));

  const webhookFailureEntries: InternalBillingTimelineEntry[] =
    reconciliation.recentWebhookFailures.map((row, index) => ({
      id: `webhook-failure:${row.eventId ?? 'unknown'}:${row.failureStage}:${index}`,
      lane: 'provider_webhook',
      entryType: 'webhook_failure',
      occurredAt: row.createdAt,
      headline: 'Stripe webhook failure',
      summary: `${row.failureStage}: ${row.failureReason}`,
      sequenceNumber: null,
      stripeEventId: row.eventId,
      sourceKind: null,
      notificationKind: null,
      communicationType: null,
      notificationChannel: null,
      notificationChannelLabel: null,
      signalKind: null,
      signalStatus: null,
      deliveryState: null,
      webhookEventType: row.eventType,
      webhookProcessingStatus: null,
      webhookFailureStage: row.failureStage,
    }));

  return [
    ...auditEntries,
    ...signalEntries,
    ...notificationEntries,
    ...webhookEventEntries,
    ...webhookFailureEntries,
  ].sort((left, right) => {
    const leftTime = left.occurredAt
      ? new Date(left.occurredAt).getTime()
      : Number.POSITIVE_INFINITY;
    const rightTime = right.occurredAt
      ? new Date(right.occurredAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    const leftSequence = left.sequenceNumber ?? Number.POSITIVE_INFINITY;
    const rightSequence = right.sequenceNumber ?? Number.POSITIVE_INFINITY;
    if (leftSequence !== rightSequence) {
      return leftSequence - rightSequence;
    }

    return left.id.localeCompare(right.id);
  });
};

export const readInternalBillingInspection = async ({
  database,
  env,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
}) => {
  const organizationRows = await database
    .select({
      id: dbSchema.organization.id,
      name: dbSchema.organization.name,
      slug: dbSchema.organization.slug,
    })
    .from(dbSchema.organization)
    .where(eq(dbSchema.organization.id, organizationId))
    .limit(1);
  const organization = organizationRows[0];
  if (!organization) {
    return null;
  }

  const billing = await selectOrganizationBillingSummary(database, organizationId);
  const planCode: 'free' | 'premium' = billing?.planCode === 'premium' ? 'premium' : 'free';
  const billingInterval = isBillingInterval(billing?.billingInterval ?? null);
  const subscriptionStatus =
    isBillingSubscriptionStatus(billing?.subscriptionStatus ?? null) ?? 'free';
  const currentPeriodEnd = toIsoDateString(billing?.currentPeriodEnd);
  const paymentMethodStatus = await resolveOrganizationBillingPaymentMethodStatus({
    env,
    planCode,
    stripeCustomerId: billing?.stripeCustomerId ?? null,
  });
  const entitlementPolicy = resolveOrganizationPremiumEntitlementPolicy({
    planCode,
    subscriptionStatus,
    paymentMethodStatus,
    currentPeriodEnd,
    pastDueGraceEndsAt:
      billing?.pastDueGraceEndsAt instanceof Date ? billing.pastDueGraceEndsAt.toISOString() : null,
    cancelAtPeriodEnd: Boolean(billing?.cancelAtPeriodEnd),
    stripePriceId: billing?.stripePriceId ?? null,
    env,
  });
  const summaryPlanState = resolveInspectionSummaryPlanState({
    planState: entitlementPolicy.planState,
    isPremiumEligible: entitlementPolicy.isPremiumEligible,
  });
  const stripeLinked = Boolean(
    billing?.stripeCustomerId ?? billing?.stripeSubscriptionId ?? billing?.stripePriceId,
  );
  const [
    recentAuditRows,
    latestSignalRows,
    notifications,
    reconciliation,
    documentReferences,
    invoicePaymentEvents,
    operationAttempts,
    paymentIssueNotificationRows,
    paymentIssueSignalRows,
  ] = await Promise.all([
    database
      .select({
        sequenceNumber: dbSchema.organizationBillingAuditEvent.sequenceNumber,
        sourceKind: dbSchema.organizationBillingAuditEvent.sourceKind,
        sourceContext: dbSchema.organizationBillingAuditEvent.sourceContext,
        stripeEventId: dbSchema.organizationBillingAuditEvent.stripeEventId,
        createdAt: dbSchema.organizationBillingAuditEvent.createdAt,
        previousPlanState: dbSchema.organizationBillingAuditEvent.previousPlanState,
        nextPlanState: dbSchema.organizationBillingAuditEvent.nextPlanState,
        previousSubscriptionStatus:
          dbSchema.organizationBillingAuditEvent.previousSubscriptionStatus,
        nextSubscriptionStatus: dbSchema.organizationBillingAuditEvent.nextSubscriptionStatus,
        previousPaymentMethodStatus:
          dbSchema.organizationBillingAuditEvent.previousPaymentMethodStatus,
        nextPaymentMethodStatus: dbSchema.organizationBillingAuditEvent.nextPaymentMethodStatus,
        previousEntitlementState: dbSchema.organizationBillingAuditEvent.previousEntitlementState,
        nextEntitlementState: dbSchema.organizationBillingAuditEvent.nextEntitlementState,
      })
      .from(dbSchema.organizationBillingAuditEvent)
      .where(eq(dbSchema.organizationBillingAuditEvent.organizationId, organizationId))
      .orderBy(desc(dbSchema.organizationBillingAuditEvent.sequenceNumber))
      .limit(5),
    database
      .select({
        sequenceNumber: dbSchema.organizationBillingSignal.sequenceNumber,
        signalKind: dbSchema.organizationBillingSignal.signalKind,
        signalStatus: dbSchema.organizationBillingSignal.signalStatus,
        sourceKind: dbSchema.organizationBillingSignal.sourceKind,
        reason: dbSchema.organizationBillingSignal.reason,
        providerPlanState: dbSchema.organizationBillingSignal.providerPlanState,
        providerSubscriptionStatus: dbSchema.organizationBillingSignal.providerSubscriptionStatus,
        createdAt: dbSchema.organizationBillingSignal.createdAt,
      })
      .from(dbSchema.organizationBillingSignal)
      .where(eq(dbSchema.organizationBillingSignal.organizationId, organizationId))
      .orderBy(desc(dbSchema.organizationBillingSignal.sequenceNumber))
      .limit(1),
    readTrialReminderDeliveryAuditInspection({
      database,
      organizationId,
      planState: entitlementPolicy.planState,
      trialEndsAt: entitlementPolicy.trialEndsAt,
      now: new Date(),
    }),
    readInternalBillingReconciliationInspection({
      database,
      organizationId,
      stripeLinked,
      appSnapshot: {
        planState: entitlementPolicy.planState,
        subscriptionStatus,
        paymentMethodStatus,
        entitlementState: entitlementPolicy.entitlementState,
      },
    }),
    readOrganizationBillingDocumentReferences({
      database,
      organizationId,
    }),
    readOrganizationBillingInvoicePaymentEvents({
      database,
      organizationId,
    }),
    readRecentBillingOperationAttempts({
      database,
      organizationId,
      limit: 10,
    }),
    database
      .select({
        sequenceNumber: dbSchema.organizationBillingNotification.sequenceNumber,
        recipientUserId: dbSchema.organizationBillingNotification.recipientUserId,
        recipientEmail: dbSchema.organizationBillingNotification.recipientEmail,
        deliveryState: dbSchema.organizationBillingNotification.deliveryState,
        failureReason: dbSchema.organizationBillingNotification.failureReason,
        notificationKind: dbSchema.organizationBillingNotification.notificationKind,
        stripeEventId: dbSchema.organizationBillingNotification.stripeEventId,
      })
      .from(dbSchema.organizationBillingNotification)
      .where(
        and(
          eq(dbSchema.organizationBillingNotification.organizationId, organizationId),
          or(
            eq(dbSchema.organizationBillingNotification.notificationKind, 'payment_failed_email'),
            eq(
              dbSchema.organizationBillingNotification.notificationKind,
              'payment_action_required_email',
            ),
            eq(
              dbSchema.organizationBillingNotification.notificationKind,
              'past_due_grace_reminder_email',
            ),
          ),
        ),
      )
      .orderBy(desc(dbSchema.organizationBillingNotification.sequenceNumber))
      .limit(50),
    database
      .select({
        reason: dbSchema.organizationBillingSignal.reason,
        status: dbSchema.organizationBillingSignal.signalStatus,
      })
      .from(dbSchema.organizationBillingSignal)
      .where(
        and(
          eq(dbSchema.organizationBillingSignal.organizationId, organizationId),
          or(
            eq(dbSchema.organizationBillingSignal.sourceKind, 'payment_failed_email'),
            eq(dbSchema.organizationBillingSignal.sourceKind, 'payment_action_required_email'),
            eq(dbSchema.organizationBillingSignal.sourceKind, 'past_due_grace_reminder_email'),
            eq(dbSchema.organizationBillingSignal.reason, 'stale_payment_issue_after_recovery'),
          ),
        ),
      )
      .orderBy(desc(dbSchema.organizationBillingSignal.sequenceNumber))
      .limit(10),
  ]);
  const paymentDocumentReadiness = buildBillingDocumentReadiness({
    organizationId,
    stripeCustomerId: billing?.stripeCustomerId ?? null,
    stripeSubscriptionId: billing?.stripeSubscriptionId ?? null,
    documents: documentReferences,
  });

  const latestSignalRow = latestSignalRows[0] ?? null;
  const latestSignal = latestSignalRow
    ? {
        sequenceNumber: latestSignalRow.sequenceNumber,
        signalKind: latestSignalRow.signalKind,
        signalStatus: latestSignalRow.signalStatus,
        sourceKind: latestSignalRow.sourceKind,
        reason: latestSignalRow.reason,
        providerPlanState: normalizeProviderPlanState(latestSignalRow.providerPlanState),
        providerSubscriptionStatus: normalizeProviderSubscriptionStatus(
          latestSignalRow.providerSubscriptionStatus,
        ),
        createdAt: toIsoDateString(latestSignalRow.createdAt),
      }
    : null;
  const paymentIssueState = resolveInspectionPaymentIssueState({
    subscriptionStatus,
    entitlementReason: entitlementPolicy.reason,
    invoicePaymentEvents,
  });
  const latestSucceededEvent = invoicePaymentEvents.find(
    (event: OrganizationBillingInvoicePaymentEvent) => event.eventType === 'payment_succeeded',
  );
  const latestSucceededTime = latestSucceededEvent
    ? getPaymentEventTime(latestSucceededEvent)
    : null;
  const staleFailureEvents =
    latestSucceededTime !== null &&
    (subscriptionStatus === 'active' ||
      subscriptionStatus === 'trialing' ||
      subscriptionStatus === 'free' ||
      subscriptionStatus === 'canceled')
      ? invoicePaymentEvents.filter((event: OrganizationBillingInvoicePaymentEvent) => {
          if (
            event.eventType !== 'payment_failed' &&
            event.eventType !== 'payment_action_required'
          ) {
            return false;
          }
          const eventTime = getPaymentEventTime(event);
          return eventTime !== null && eventTime < latestSucceededTime;
        })
      : [];
  const latestRecipientNotifications = new Map<
    string,
    (typeof paymentIssueNotificationRows)[number]
  >();
  for (const row of paymentIssueNotificationRows) {
    const recipientKey = row.recipientUserId ?? row.recipientEmail ?? 'unassigned';
    const key = `${recipientKey}:${row.stripeEventId ?? 'no-event'}:${row.notificationKind}`;
    if (!latestRecipientNotifications.has(key)) {
      latestRecipientNotifications.set(key, row);
    }
  }
  const notificationRecipients = [...latestRecipientNotifications.values()].map((row) => {
    const normalizedDeliveryState = normalizeOrganizationBillingNotificationDeliveryState(
      row.deliveryState,
    );
    const deliveryState =
      normalizedDeliveryState === 'unknown' ? ('failed' as const) : normalizedDeliveryState;

    return {
      recipientUserId: row.recipientUserId ?? null,
      recipientEmail: row.recipientEmail ?? null,
      deliveryState,
      retryEligible: Boolean(row.recipientUserId && deliveryState === 'failed'),
      failureReason: row.failureReason ?? null,
    };
  });

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    organizationSlug: organization.slug,
    summary: {
      planCode,
      planState: summaryPlanState,
      paidTier: entitlementPolicy.paidTier,
      lifecycleStage: toLifecycleStage(summaryPlanState),
      lifecycleReason: entitlementPolicy.reason,
      entitlementState: entitlementPolicy.entitlementState,
      billingInterval,
      subscriptionStatus,
      paymentMethodStatus,
      currentPeriodEnd,
      trialEndsAt: entitlementPolicy.trialEndsAt,
      cancelAtPeriodEnd: Boolean(billing?.cancelAtPeriodEnd),
      stripeLinked,
      billingProfileReadiness: resolveOrganizationBillingProfileReadiness(billing),
    },
    provider: stripeLinked
      ? {
          stripeCustomerId: billing?.stripeCustomerId ?? null,
          stripeSubscriptionId: billing?.stripeSubscriptionId ?? null,
          stripePriceId: billing?.stripePriceId ?? null,
          providerPlanState: reconciliation.currentComparison.providerPlanState,
          providerSubscriptionStatus: reconciliation.currentComparison.providerSubscriptionStatus,
          paymentMethodStatus,
          paidTier: entitlementPolicy.paidTier,
        }
      : null,
    lifecycle: {
      recentEvents: recentAuditRows.reverse().map((row: (typeof recentAuditRows)[number]) => ({
        sequenceNumber: row.sequenceNumber,
        sourceKind: row.sourceKind,
        sourceContext: row.sourceContext,
        createdAt: toIsoDateString(row.createdAt),
        transition: {
          previousPlanState: row.previousPlanState,
          nextPlanState: row.nextPlanState,
          previousSubscriptionStatus: row.previousSubscriptionStatus,
          nextSubscriptionStatus: row.nextSubscriptionStatus,
          previousPaymentMethodStatus: row.previousPaymentMethodStatus,
          nextPaymentMethodStatus: row.nextPaymentMethodStatus,
          previousEntitlementState: row.previousEntitlementState,
          nextEntitlementState: row.nextEntitlementState,
        },
      })),
      latestSignal,
    },
    reconciliation,
    notifications,
    paymentIssue: {
      paymentIssueState,
      notificationRecipients,
      staleFailureEvents,
      supportSignals: paymentIssueSignalRows.map(
        (row: (typeof paymentIssueSignalRows)[number]) => ({
          reason: row.reason,
          status: row.status,
        }),
      ),
    },
    paymentDocuments: buildInternalBillingDocumentInspection({
      readiness: paymentDocumentReadiness,
    }),
    invoicePaymentEvents,
    operationAttempts: operationAttempts.map((attempt: (typeof operationAttempts)[number]) => ({
      id: attempt.id,
      purpose: attempt.purpose,
      billingInterval: attempt.billingInterval,
      state: attempt.state,
      handoffExpiresAt: toIsoDateString(attempt.handoffExpiresAt),
      provider: attempt.provider,
      stripeCustomerId: attempt.stripeCustomerId,
      stripeSubscriptionId: attempt.stripeSubscriptionId,
      stripeCheckoutSessionId: attempt.stripeCheckoutSessionId,
      stripePortalSessionId: attempt.stripePortalSessionId,
      failureReason: attempt.failureReason,
      createdByUserId: attempt.createdByUserId,
      createdAt: toIsoDateString(attempt.createdAt),
      updatedAt: toIsoDateString(attempt.updatedAt),
    })),
    timeline: {
      entries: buildInternalBillingInvestigationTimeline({
        auditRows: recentAuditRows,
        reconciliation,
        notifications,
      }),
    },
  };
};
