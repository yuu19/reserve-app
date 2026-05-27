import type {
  BillingAccount,
  BillingEntitlement,
  BillingEntitlementInput,
  BillingPaymentIssue,
  BillingPaymentIssueEventInput,
  BillingPaymentIssueStartedAtSource,
  BillingPaymentIssueState,
  BillingPaymentIssueUpsert,
  BillingProviderCode,
  BillingStore,
  BillingSubjectType,
  BillingSubscription,
  BillingSubscriptionStatus,
  BillingSubscriptionUpsert,
} from '@repo/saas-billing-core';
import { and, desc, eq } from 'drizzle-orm';
import type { DrizzleBillingDatabase } from './database.js';
import * as dbSchema from './schema.js';

// Drizzle schema は text column で provider を保持するため、core port へ返す前に既知 provider へ丸める。
const normalizeProvider = (value: string): BillingProviderCode =>
  value === 'stripe' ? value : 'stripe';

const normalizeSubjectType = (value: string): BillingSubjectType => value;

const normalizeSubscriptionStatus = (value: string): BillingSubscriptionStatus => {
  if (
    value === 'free' ||
    value === 'trialing' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'canceled' ||
    value === 'unpaid' ||
    value === 'incomplete'
  ) {
    return value;
  }
  return 'free';
};

const normalizeInterval = (value: string | null): BillingSubscription['interval'] =>
  value === 'month' || value === 'year' ? value : null;

const normalizePaymentIssueState = (value: string): BillingPaymentIssueState => {
  if (
    value === 'none' ||
    value === 'payment_failed' ||
    value === 'payment_action_required' ||
    value === 'past_due_grace_active' ||
    value === 'past_due_grace_expired' ||
    value === 'unpaid' ||
    value === 'incomplete' ||
    value === 'recovered' ||
    value === 'stale_failure_history_only'
  ) {
    return value;
  }
  return 'none';
};

const normalizeIssueStartedAtSource = (value: string): BillingPaymentIssueStartedAtSource => {
  if (value === 'provider_issue_time' || value === 'application_receipt_time' || value === 'none') {
    return value;
  }
  return 'none';
};

const toAccount = (row: typeof dbSchema.billingAccount.$inferSelect): BillingAccount => ({
  id: row.id,
  subjectType: normalizeSubjectType(row.subjectType),
  subjectId: row.subjectId,
  provider: normalizeProvider(row.provider),
  providerCustomerId: row.providerCustomerId ?? null,
  billingEmail: row.billingEmail ?? null,
  billingName: row.billingName ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toSubscription = (
  row: typeof dbSchema.billingSubscription.$inferSelect,
): BillingSubscription => ({
  id: row.id,
  billingAccountId: row.billingAccountId,
  provider: normalizeProvider(row.provider),
  providerSubscriptionId: row.providerSubscriptionId ?? null,
  providerScheduleId: row.providerScheduleId ?? null,
  planCode: row.planCode,
  priceCode: row.priceCode ?? null,
  interval: normalizeInterval(row.interval),
  status: normalizeSubscriptionStatus(row.status),
  currentPeriodStart: row.currentPeriodStart ?? null,
  currentPeriodEnd: row.currentPeriodEnd ?? null,
  trialStart: row.trialStart ?? null,
  trialEnd: row.trialEnd ?? null,
  cancelAt: row.cancelAt ?? null,
  cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toEntitlement = (
  row: typeof dbSchema.billingEntitlement.$inferSelect,
): BillingEntitlement => ({
  id: row.id,
  billingAccountId: row.billingAccountId,
  key: row.key,
  active: Boolean(row.active),
  source:
    row.source === 'trial' ||
    row.source === 'paid' ||
    row.source === 'manual' ||
    row.source === 'admin_override'
      ? row.source
      : 'free',
  reason: row.reason,
  validFrom: row.validFrom ?? null,
  validUntil: row.validUntil ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toPaymentIssue = (
  row: typeof dbSchema.billingPaymentIssue.$inferSelect,
): BillingPaymentIssue => ({
  id: row.id,
  billingAccountId: row.billingAccountId,
  billingSubscriptionId: row.billingSubscriptionId ?? null,
  state: normalizePaymentIssueState(row.state),
  issueStartedAt: row.issueStartedAt ?? null,
  issueStartedAtSource: normalizeIssueStartedAtSource(row.issueStartedAtSource),
  pastDueGraceEndsAt: row.pastDueGraceEndsAt ?? null,
  latestProviderEventId: row.latestProviderEventId ?? null,
  latestInvoiceId: row.latestInvoiceId ?? null,
  latestPaymentIntentId: row.latestPaymentIntentId ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** Drizzle 版 billing store を構成する依存。 */
export type DrizzleBillingStoreOptions = {
  /** billing schema tables を含む Drizzle database。 */
  database: DrizzleBillingDatabase;
  /** 新規 billing row の ID を生成する関数。未指定時は `crypto.randomUUID()`。 */
  createId?: () => string;
  /** 作成・更新時刻に使う時刻 provider。 */
  now?: () => Date;
};

/**
 * core の `BillingStore` port を Drizzle schema 上で実装する。
 *
 * @param input.database billing schema tables を含む Drizzle database。
 * @param input.createId 新規 billing row の ID を生成する関数。
 * @param input.now 作成・更新時刻に使う時刻 provider。
 * @returns `BillingStore` port 実装。
 *
 * @throws Error account insert が競合し、再読込でも取得できない場合は `BILLING_ACCOUNT_ENSURE_FAILED`。
 */
export const createDrizzleBillingStore = ({
  database,
  createId = () => crypto.randomUUID(),
  now: readNow = () => new Date(),
}: DrizzleBillingStoreOptions): BillingStore => ({
  async findAccountBySubject({ subjectType, subjectId }) {
    const rows = await database
      .select()
      .from(dbSchema.billingAccount)
      .where(
        and(
          eq(dbSchema.billingAccount.subjectType, subjectType),
          eq(dbSchema.billingAccount.subjectId, subjectId),
        ),
      )
      .limit(1);
    return rows[0] ? toAccount(rows[0]) : null;
  },

  async ensureAccount({
    subjectType,
    subjectId,
    provider,
    billingEmail = null,
    billingName = null,
  }) {
    const now = readNow();
    const insertedRows = await database
      .insert(dbSchema.billingAccount)
      .values({
        id: createId(),
        subjectType,
        subjectId,
        provider,
        billingEmail,
        billingName,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (insertedRows[0]) {
      return toAccount(insertedRows[0]);
    }

    const rows = await database
      .select()
      .from(dbSchema.billingAccount)
      .where(
        and(
          eq(dbSchema.billingAccount.subjectType, subjectType),
          eq(dbSchema.billingAccount.subjectId, subjectId),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) {
      throw new Error('BILLING_ACCOUNT_ENSURE_FAILED');
    }
    return toAccount(existing);
  },

  async updateProviderCustomerId({ billingAccountId, providerCustomerId }) {
    await database
      .update(dbSchema.billingAccount)
      .set({
        providerCustomerId,
        updatedAt: readNow(),
      })
      .where(eq(dbSchema.billingAccount.id, billingAccountId));
  },

  async findAccountByProviderCustomer({ provider, providerCustomerId }) {
    const rows = await database
      .select()
      .from(dbSchema.billingAccount)
      .where(
        and(
          eq(dbSchema.billingAccount.provider, provider),
          eq(dbSchema.billingAccount.providerCustomerId, providerCustomerId),
        ),
      )
      .limit(1);
    return rows[0] ? toAccount(rows[0]) : null;
  },

  async findCurrentSubscription({ billingAccountId }) {
    const rows = await database
      .select()
      .from(dbSchema.billingSubscription)
      .where(eq(dbSchema.billingSubscription.billingAccountId, billingAccountId))
      .orderBy(desc(dbSchema.billingSubscription.updatedAt))
      .limit(1);
    return rows[0] ? toSubscription(rows[0]) : null;
  },

  async findSubscriptionByProviderSubscription({ provider, providerSubscriptionId }) {
    const rows = await database
      .select()
      .from(dbSchema.billingSubscription)
      .where(
        and(
          eq(dbSchema.billingSubscription.provider, provider),
          eq(dbSchema.billingSubscription.providerSubscriptionId, providerSubscriptionId),
        ),
      )
      .limit(1);
    return rows[0] ? toSubscription(rows[0]) : null;
  },

  async upsertSubscription(input: BillingSubscriptionUpsert) {
    const now = readNow();
    const existingRows = input.providerSubscriptionId
      ? await database
          .select()
          .from(dbSchema.billingSubscription)
          .where(
            and(
              eq(dbSchema.billingSubscription.provider, input.provider),
              eq(dbSchema.billingSubscription.providerSubscriptionId, input.providerSubscriptionId),
            ),
          )
          .limit(1)
      : [];
    const currentAccountRows =
      existingRows.length > 0
        ? existingRows
        : await database
            .select()
            .from(dbSchema.billingSubscription)
            .where(eq(dbSchema.billingSubscription.billingAccountId, input.billingAccountId))
            .orderBy(desc(dbSchema.billingSubscription.updatedAt))
            .limit(1);
    const existing = currentAccountRows[0] ? toSubscription(currentAccountRows[0]) : null;

    if (!existing) {
      const rows = await database
        .insert(dbSchema.billingSubscription)
        .values({
          id: createId(),
          billingAccountId: input.billingAccountId,
          provider: input.provider,
          providerSubscriptionId: input.providerSubscriptionId ?? null,
          providerScheduleId: input.providerScheduleId ?? null,
          planCode: input.planCode,
          priceCode: input.priceCode ?? null,
          interval: input.interval ?? null,
          status: input.status,
          currentPeriodStart: input.currentPeriodStart ?? null,
          currentPeriodEnd: input.currentPeriodEnd ?? null,
          trialStart: input.trialStart ?? null,
          trialEnd: input.trialEnd ?? null,
          cancelAt: input.cancelAt ?? null,
          cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return toSubscription(rows[0]);
    }

    const rows = await database
      .update(dbSchema.billingSubscription)
      .set({
        providerSubscriptionId: input.providerSubscriptionId ?? null,
        providerScheduleId: input.providerScheduleId ?? null,
        planCode: input.planCode,
        priceCode: input.priceCode ?? null,
        interval: input.interval ?? null,
        status: input.status,
        currentPeriodStart: input.currentPeriodStart ?? null,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        trialStart: input.trialStart ?? null,
        trialEnd: input.trialEnd ?? null,
        cancelAt: input.cancelAt ?? null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        updatedAt: now,
      })
      .where(eq(dbSchema.billingSubscription.id, existing.id))
      .returning();
    return toSubscription(rows[0]);
  },

  async readEntitlements({ billingAccountId }) {
    const rows = await database
      .select()
      .from(dbSchema.billingEntitlement)
      .where(eq(dbSchema.billingEntitlement.billingAccountId, billingAccountId));
    return rows.map(toEntitlement);
  },

  async replaceEntitlements({ billingAccountId, entitlements }) {
    await database
      .delete(dbSchema.billingEntitlement)
      .where(eq(dbSchema.billingEntitlement.billingAccountId, billingAccountId));

    if (entitlements.length === 0) {
      return;
    }

    const now = readNow();
    await database.insert(dbSchema.billingEntitlement).values(
      entitlements.map((entitlement: BillingEntitlementInput) => ({
        id: createId(),
        billingAccountId,
        key: entitlement.key,
        active: entitlement.active,
        source: entitlement.source,
        reason: entitlement.reason,
        validFrom: entitlement.validFrom ?? null,
        validUntil: entitlement.validUntil ?? null,
        createdAt: now,
        updatedAt: now,
      })),
    );
  },

  async readPaymentIssue({ billingAccountId }) {
    const rows = await database
      .select()
      .from(dbSchema.billingPaymentIssue)
      .where(eq(dbSchema.billingPaymentIssue.billingAccountId, billingAccountId))
      .limit(1);
    return rows[0] ? toPaymentIssue(rows[0]) : null;
  },

  async upsertPaymentIssue(input: BillingPaymentIssueUpsert) {
    const now = readNow();
    await database
      .insert(dbSchema.billingPaymentIssue)
      .values({
        id: createId(),
        billingAccountId: input.billingAccountId,
        billingSubscriptionId: input.billingSubscriptionId ?? null,
        state: input.state,
        issueStartedAt: input.issueStartedAt ?? null,
        issueStartedAtSource: input.issueStartedAtSource,
        pastDueGraceEndsAt: input.pastDueGraceEndsAt ?? null,
        latestProviderEventId: input.latestProviderEventId ?? null,
        latestInvoiceId: input.latestInvoiceId ?? null,
        latestPaymentIntentId: input.latestPaymentIntentId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: dbSchema.billingPaymentIssue.billingAccountId,
        set: {
          billingSubscriptionId: input.billingSubscriptionId ?? null,
          state: input.state,
          issueStartedAt: input.issueStartedAt ?? null,
          issueStartedAtSource: input.issueStartedAtSource,
          pastDueGraceEndsAt: input.pastDueGraceEndsAt ?? null,
          latestProviderEventId: input.latestProviderEventId ?? null,
          latestInvoiceId: input.latestInvoiceId ?? null,
          latestPaymentIntentId: input.latestPaymentIntentId ?? null,
          updatedAt: now,
        },
      });
  },

  async appendPaymentIssueEvent(input: BillingPaymentIssueEventInput) {
    await database
      .insert(dbSchema.billingInvoiceEvent)
      .values({
        id: createId(),
        billingAccountId: input.billingAccountId,
        billingSubscriptionId: input.billingSubscriptionId ?? null,
        eventType: input.eventType,
        provider: input.provider,
        providerEventId: input.providerEventId ?? null,
        providerInvoiceId: input.providerInvoiceId ?? null,
        providerPaymentIntentId: input.providerPaymentIntentId ?? null,
        occurredAt: input.occurredAt ?? null,
      })
      .onConflictDoNothing();
  },
});
