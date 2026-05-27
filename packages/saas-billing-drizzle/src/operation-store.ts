import {
  BILLING_OPERATION_PENDING_STALE_MS,
  buildBillingOperationIdempotencyKey,
  type BillingOperationAttempt,
  type BillingOperationAttemptState,
  type BillingOperationPurpose,
  type BillingOperationReuseKey,
  type BillingOperationStore,
  type BillingProviderCode,
} from '@repo/saas-billing-core';
import { and, desc, eq, gt, lt, max } from 'drizzle-orm';
import type { DrizzleBillingDatabase } from './database.js';
import * as dbSchema from './schema.js';

const normalizeProvider = (value: string): BillingProviderCode =>
  value === 'stripe' ? value : 'stripe';

const normalizePurpose = (value: string): BillingOperationPurpose => {
  if (
    value === 'start_trial_subscription' ||
    value === 'create_subscription_checkout' ||
    value === 'create_setup_checkout' ||
    value === 'create_portal_session'
  ) {
    return value;
  }
  return 'create_subscription_checkout';
};

const normalizeState = (value: string): BillingOperationAttemptState => {
  if (
    value === 'processing' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'expired' ||
    value === 'conflict'
  ) {
    return value;
  }
  return 'failed';
};

const toAttempt = (
  row: typeof dbSchema.billingOperationAttempt.$inferSelect,
): BillingOperationAttempt => ({
  id: row.id,
  billingAccountId: row.billingAccountId,
  purpose: normalizePurpose(row.purpose),
  reuseKey: row.reuseKey as BillingOperationReuseKey,
  attemptNumber: row.attemptNumber,
  idempotencyKey: row.idempotencyKey,
  state: normalizeState(row.state),
  handoffUrl: row.handoffUrl ?? null,
  handoffExpiresAt: row.handoffExpiresAt ?? null,
  provider: normalizeProvider(row.provider),
  providerCustomerId: row.providerCustomerId ?? null,
  providerSubscriptionId: row.providerSubscriptionId ?? null,
  providerCheckoutSessionId: row.providerCheckoutSessionId ?? null,
  providerPortalSessionId: row.providerPortalSessionId ?? null,
  failureReason: row.failureReason ?? null,
  createdByUserId: row.createdByUserId ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const readReusableSucceededAttempt = async ({
  database,
  billingAccountId,
  reuseKey,
  now,
}: {
  database: DrizzleBillingDatabase;
  billingAccountId: string;
  reuseKey: BillingOperationReuseKey;
  now: Date;
}) => {
  const rows = await database
    .select()
    .from(dbSchema.billingOperationAttempt)
    .where(
      and(
        eq(dbSchema.billingOperationAttempt.billingAccountId, billingAccountId),
        eq(dbSchema.billingOperationAttempt.reuseKey, reuseKey),
        eq(dbSchema.billingOperationAttempt.state, 'succeeded'),
        gt(dbSchema.billingOperationAttempt.handoffExpiresAt, now),
      ),
    )
    .orderBy(desc(dbSchema.billingOperationAttempt.createdAt))
    .limit(1);

  const row = rows[0];
  return row?.handoffUrl && row.handoffExpiresAt && row.handoffExpiresAt.getTime() > now.getTime()
    ? toAttempt(row)
    : null;
};

const readFreshProcessingAttempt = async ({
  database,
  billingAccountId,
  reuseKey,
  now,
}: {
  database: DrizzleBillingDatabase;
  billingAccountId: string;
  reuseKey: BillingOperationReuseKey;
  now: Date;
}) => {
  const staleBefore = new Date(now.getTime() - BILLING_OPERATION_PENDING_STALE_MS);
  const rows = await database
    .select()
    .from(dbSchema.billingOperationAttempt)
    .where(
      and(
        eq(dbSchema.billingOperationAttempt.billingAccountId, billingAccountId),
        eq(dbSchema.billingOperationAttempt.reuseKey, reuseKey),
        eq(dbSchema.billingOperationAttempt.state, 'processing'),
        gt(dbSchema.billingOperationAttempt.createdAt, staleBefore),
      ),
    )
    .orderBy(desc(dbSchema.billingOperationAttempt.createdAt))
    .limit(1);
  return rows[0] ? toAttempt(rows[0]) : null;
};

// attemptNumber は reuse key 内の履歴順序なので、insert 直前に最新値から採番する。
const readNextAttemptNumber = async ({
  database,
  billingAccountId,
  reuseKey,
}: {
  database: DrizzleBillingDatabase;
  billingAccountId: string;
  reuseKey: BillingOperationReuseKey;
}) => {
  const rows = await database
    .select({
      attemptNumber: max(dbSchema.billingOperationAttempt.attemptNumber),
    })
    .from(dbSchema.billingOperationAttempt)
    .where(
      and(
        eq(dbSchema.billingOperationAttempt.billingAccountId, billingAccountId),
        eq(dbSchema.billingOperationAttempt.reuseKey, reuseKey),
      ),
    );

  return Number(rows[0]?.attemptNumber ?? 0) + 1;
};

/** Drizzle 版の課金操作試行の永続化処理を構成する依存。 */
export type DrizzleBillingOperationStoreOptions = {
  /** billing_operation_attempt table を含む Drizzle database。 */
  database: DrizzleBillingDatabase;
  /** 新規の試行 row の ID を生成する関数。未指定時は `crypto.randomUUID()`。 */
  createId?: () => string;
  /** mark 系更新時刻に使う時刻の取得関数。 */
  now?: () => Date;
};

/**
 * 決済プロバイダーへの引き渡し操作の冪等性と再利用を Drizzle table で管理する永続化処理を作る。
 *
 * @param input.database billing_operation_attempt table を含む Drizzle database。
 * @param input.createId 新規の試行 row の ID を生成する関数。
 * @param input.now mark 系更新時刻に使う時刻の取得関数。
 * @returns `BillingOperationStore` の実装。
 *
 * @throws Error insert conflict を解消できない場合は `BILLING_OPERATION_ATTEMPT_CLAIM_FAILED`。
 */
export const createDrizzleBillingOperationStore = ({
  database,
  createId = () => crypto.randomUUID(),
  now: readNow = () => new Date(),
}: DrizzleBillingOperationStoreOptions): BillingOperationStore => ({
  async claimAttempt({
    billingAccountId,
    purpose,
    reuseKey,
    provider,
    createdByUserId = null,
    now,
  }) {
    const reusableSucceeded = await readReusableSucceededAttempt({
      database,
      billingAccountId,
      reuseKey,
      now,
    });
    if (reusableSucceeded) {
      return {
        kind: 'reused_succeeded',
        attempt: reusableSucceeded,
      };
    }

    const freshProcessing = await readFreshProcessingAttempt({
      database,
      billingAccountId,
      reuseKey,
      now,
    });
    if (freshProcessing) {
      return {
        kind: 'already_processing_fresh',
        attempt: freshProcessing,
      };
    }

    // 古い処理中状態は expired に倒してから、新しい試行を同じ reuse key で取得する。
    await database
      .update(dbSchema.billingOperationAttempt)
      .set({
        state: 'expired',
        failureReason: 'processing attempt exceeded freshness window',
        updatedAt: now,
      })
      .where(
        and(
          eq(dbSchema.billingOperationAttempt.billingAccountId, billingAccountId),
          eq(dbSchema.billingOperationAttempt.reuseKey, reuseKey),
          eq(dbSchema.billingOperationAttempt.state, 'processing'),
          lt(
            dbSchema.billingOperationAttempt.createdAt,
            new Date(now.getTime() - BILLING_OPERATION_PENDING_STALE_MS),
          ),
        ),
      );

    const attemptNumber = await readNextAttemptNumber({
      database,
      billingAccountId,
      reuseKey,
    });
    const idempotencyKey = buildBillingOperationIdempotencyKey({
      reuseKey,
      attemptNumber,
    });

    const rows = await database
      .insert(dbSchema.billingOperationAttempt)
      .values({
        id: createId(),
        billingAccountId,
        purpose,
        reuseKey,
        attemptNumber,
        idempotencyKey,
        state: 'processing',
        provider,
        createdByUserId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (rows[0]) {
      return {
        kind: 'claimed',
        attempt: toAttempt(rows[0]),
      };
    }

    const existingRows = await database
      .select()
      .from(dbSchema.billingOperationAttempt)
      .where(eq(dbSchema.billingOperationAttempt.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existingRows[0]) {
      return {
        kind: 'already_processing_fresh',
        attempt: toAttempt(existingRows[0]),
      };
    }

    throw new Error('BILLING_OPERATION_ATTEMPT_CLAIM_FAILED');
  },

  async markSucceeded({
    attemptId,
    handoffUrl = null,
    handoffExpiresAt = null,
    providerCustomerId = null,
    providerSubscriptionId = null,
    providerCheckoutSessionId = null,
    providerPortalSessionId = null,
  }) {
    const rows = await database
      .update(dbSchema.billingOperationAttempt)
      .set({
        state: 'succeeded',
        handoffUrl,
        handoffExpiresAt,
        providerCustomerId,
        providerSubscriptionId,
        providerCheckoutSessionId,
        providerPortalSessionId,
        failureReason: null,
        updatedAt: readNow(),
      })
      .where(eq(dbSchema.billingOperationAttempt.id, attemptId))
      .returning();
    return rows[0] ? toAttempt(rows[0]) : null;
  },

  async markFailed({ attemptId, state = 'failed', failureReason }) {
    const rows = await database
      .update(dbSchema.billingOperationAttempt)
      .set({
        state,
        failureReason,
        updatedAt: readNow(),
      })
      .where(eq(dbSchema.billingOperationAttempt.id, attemptId))
      .returning();
    return rows[0] ? toAttempt(rows[0]) : null;
  },

  async readRecent({ billingAccountId, limit = 10 }) {
    const rows = await database
      .select()
      .from(dbSchema.billingOperationAttempt)
      .where(eq(dbSchema.billingOperationAttempt.billingAccountId, billingAccountId))
      .orderBy(desc(dbSchema.billingOperationAttempt.createdAt))
      .limit(Math.max(1, Math.min(Math.trunc(limit), 50)));
    return rows.map(toAttempt);
  },
});
