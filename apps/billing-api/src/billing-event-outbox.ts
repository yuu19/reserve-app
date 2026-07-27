import type {
  BillingApiInvoiceEventType,
  BillingSubjectChangedEvent,
  BillingSubjectChangedReason,
} from '@repo/billing-types';
import type { BatchItem } from 'drizzle-orm/batch';
import { and, eq, lte } from 'drizzle-orm';
import type { BillingApiDatabase } from './db/database.js';
import * as dbSchema from './db/schema.js';

export type BillingEventQueue = Queue<BillingSubjectChangedEvent>;

export type BillingSubjectEventResource = BillingSubjectChangedEvent['affectedResources'][number];

type BillingSubjectRow = typeof dbSchema.billingSubject.$inferSelect;

type BillingSubjectChangeInput = {
  db: BillingApiDatabase;
  subject: BillingSubjectRow;
  reason: BillingSubjectChangedReason;
  affectedResources: BillingSubjectEventResource[];
  providerEventId?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  invoiceEvent?: {
    id: string;
    type: BillingApiInvoiceEventType;
    providerInvoiceId: string | null;
    providerPaymentIntentId: string | null;
    providerStatus: string | null;
    occurredAt: Date | null;
  } | null;
  occurredAt?: Date;
};

export const resolveBillingEventDeliveryMode = (
  subject: BillingSubjectRow,
): 'production' | 'test' => {
  try {
    const metadata = JSON.parse(subject.metadataJson) as unknown;
    const isTestClock =
      typeof metadata === 'object' &&
      metadata !== null &&
      'source' in metadata &&
      metadata.source === 'billing-api-test-clock';
    return isTestClock ? 'test' : 'production';
  } catch {
    return 'production';
  }
};

export const createBillingSubjectChangedEvent = ({
  subject,
  reason,
  affectedResources,
  providerEventId = null,
  providerCustomerId = null,
  providerSubscriptionId = null,
  invoiceEvent = null,
  occurredAt = new Date(),
}: Omit<BillingSubjectChangeInput, 'db'>): BillingSubjectChangedEvent => ({
  schemaVersion: 1,
  eventId: crypto.randomUUID(),
  eventType: 'billing.subject.changed.v1',
  appId: subject.appId,
  subject: {
    type: subject.subjectType,
    id: subject.subjectId,
    revision: subject.eventRevision + 1,
  },
  reason,
  affectedResources: [...new Set(affectedResources)],
  occurredAt: occurredAt.toISOString(),
  provider: {
    name: 'stripe',
    eventId: providerEventId,
    customerId: providerCustomerId,
    subscriptionId: providerSubscriptionId,
  },
  invoiceEvent: invoiceEvent
    ? {
        id: invoiceEvent.id,
        type: invoiceEvent.type,
        providerInvoiceId: invoiceEvent.providerInvoiceId,
        providerPaymentIntentId: invoiceEvent.providerPaymentIntentId,
        providerStatus: invoiceEvent.providerStatus,
        occurredAt: invoiceEvent.occurredAt?.toISOString() ?? null,
      }
    : null,
});

/**
 * 課金状態の更新と subject revision、outbox 行を同じ D1 batch で確定する。
 *
 * `(subject_row_id, revision)` の一意制約が並行更新を検出する。競合時は batch
 * 全体がロールバックされるため、呼び出し側は Stripe を再実行せずローカル永続化を再試行できる。
 */
export const commitBillingSubjectChange = async ({
  db,
  stateStatements,
  ...eventInput
}: BillingSubjectChangeInput & {
  stateStatements: BatchItem<'sqlite'>[];
}): Promise<BillingSubjectChangedEvent> => {
  const event = createBillingSubjectChangedEvent(eventInput);
  const occurredAt = new Date(event.occurredAt);
  const committedAt = new Date();
  const deliveryMode = resolveBillingEventDeliveryMode(eventInput.subject);
  const statements: BatchItem<'sqlite'>[] = [
    ...stateStatements,
    db
      .update(dbSchema.billingSubject)
      .set({
        eventRevision: event.subject.revision,
        updatedAt: committedAt,
      })
      .where(
        and(
          eq(dbSchema.billingSubject.id, eventInput.subject.id),
          eq(dbSchema.billingSubject.eventRevision, eventInput.subject.eventRevision),
        ),
      ),
    db.insert(dbSchema.billingEventOutbox).values({
      id: event.eventId,
      appId: event.appId,
      subjectRowId: eventInput.subject.id,
      subjectType: event.subject.type,
      subjectId: event.subject.id,
      revision: event.subject.revision,
      eventType: event.eventType,
      reason: event.reason,
      payloadJson: JSON.stringify(event),
      deliveryMode,
      dispatchStatus: deliveryMode === 'test' ? 'suppressed' : 'pending',
      dispatchAttempts: 0,
      nextAttemptAt: committedAt,
      failureReason: deliveryMode === 'test' ? 'test_clock_subject' : null,
      occurredAt,
      createdAt: committedAt,
      updatedAt: committedAt,
    }),
  ];
  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  return event;
};

const retryDelayMs = (attempt: number): number =>
  Math.min(12 * 60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempt - 1));

export const dispatchBillingEvent = async ({
  db,
  queue,
  eventId,
}: {
  db: BillingApiDatabase;
  queue?: BillingEventQueue;
  eventId: string;
}): Promise<boolean> => {
  if (!queue) {
    return false;
  }
  const rows = await db
    .select()
    .from(dbSchema.billingEventOutbox)
    .where(eq(dbSchema.billingEventOutbox.id, eventId))
    .limit(1);
  const row = rows[0];
  if (!row || row.dispatchStatus !== 'pending' || row.deliveryMode !== 'production') {
    return false;
  }
  const attemptedAt = new Date();
  try {
    await queue.send(JSON.parse(row.payloadJson) as BillingSubjectChangedEvent, {
      contentType: 'json',
    });
    await db
      .update(dbSchema.billingEventOutbox)
      .set({
        dispatchStatus: 'published',
        dispatchAttempts: row.dispatchAttempts + 1,
        lastAttemptAt: attemptedAt,
        publishedAt: attemptedAt,
        failureReason: null,
        updatedAt: attemptedAt,
      })
      .where(eq(dbSchema.billingEventOutbox.id, row.id));
    return true;
  } catch (error) {
    const attempts = row.dispatchAttempts + 1;
    try {
      await db
        .update(dbSchema.billingEventOutbox)
        .set({
          dispatchAttempts: attempts,
          lastAttemptAt: attemptedAt,
          nextAttemptAt: new Date(attemptedAt.getTime() + retryDelayMs(attempts)),
          failureReason: error instanceof Error ? error.message.slice(0, 500) : 'queue_send_failed',
          updatedAt: attemptedAt,
        })
        .where(eq(dbSchema.billingEventOutbox.id, row.id));
    } catch (recordError) {
      console.error('[billing-event] Failed to record queue dispatch failure.', recordError);
    }
    return false;
  }
};

export const dispatchPendingBillingEvents = async ({
  db,
  queue,
  limit = 50,
}: {
  db: BillingApiDatabase;
  queue?: BillingEventQueue;
  limit?: number;
}): Promise<{ selected: number; published: number }> => {
  if (!queue) {
    return { selected: 0, published: 0 };
  }
  const rows = await db
    .select({ id: dbSchema.billingEventOutbox.id })
    .from(dbSchema.billingEventOutbox)
    .where(
      and(
        eq(dbSchema.billingEventOutbox.dispatchStatus, 'pending'),
        eq(dbSchema.billingEventOutbox.deliveryMode, 'production'),
        lte(dbSchema.billingEventOutbox.nextAttemptAt, new Date()),
      ),
    )
    .orderBy(dbSchema.billingEventOutbox.createdAt)
    .limit(limit);
  let published = 0;
  for (const row of rows) {
    if (await dispatchBillingEvent({ db, queue, eventId: row.id })) {
      published += 1;
    }
  }
  return { selected: rows.length, published };
};
