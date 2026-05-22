import {
  buildPortalSessionReuseKey,
  buildSetupCheckoutReuseKey,
  buildStartTrialSubscriptionReuseKey,
  buildSubscriptionCheckoutReuseKey,
  type BillingOperationReuseKey,
} from '@repo/saas-billing-core';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import * as dbSchema from '../../infra/db/schema.js';

export const BILLING_HANDOFF_REUSE_WINDOW_MS = 30 * 60 * 1000;
export const BILLING_OPERATION_PENDING_STALE_MS = 2 * 60 * 1000;

export type OrganizationBillingOperationPurpose =
  | 'trial_start'
  | 'paid_checkout'
  | 'payment_method_setup'
  | 'billing_portal';
export type OrganizationBillingOperationState =
  | 'processing'
  | 'succeeded'
  | 'conflict'
  | 'expired'
  | 'failed';

export type OrganizationBillingOperationAttempt = {
  id: string;
  organizationId: string;
  purpose: OrganizationBillingOperationPurpose;
  billingInterval: 'month' | 'year' | null;
  state: OrganizationBillingOperationState;
  handoffUrl: string | null;
  handoffExpiresAt: Date | null;
  provider: 'stripe';
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeCheckoutSessionId: string | null;
  stripePortalSessionId: string | null;
  reuseKey: BillingOperationReuseKey | null;
  idempotencyKey: string;
  failureReason: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const normalizePurpose = (value: string): OrganizationBillingOperationPurpose =>
  value === 'trial_start' ||
  value === 'paid_checkout' ||
  value === 'payment_method_setup' ||
  value === 'billing_portal'
    ? value
    : 'paid_checkout';

const normalizeState = (value: string): OrganizationBillingOperationState =>
  value === 'processing' ||
  value === 'succeeded' ||
  value === 'conflict' ||
  value === 'expired' ||
  value === 'failed'
    ? value
    : 'failed';

const normalizeBillingInterval = (value: string | null): 'month' | 'year' | null =>
  value === 'month' || value === 'year' ? value : null;

const normalizeGenericPurpose = (value: string): OrganizationBillingOperationPurpose => {
  if (value === 'start_trial_subscription') {
    return 'trial_start';
  }
  if (value === 'create_setup_checkout') {
    return 'payment_method_setup';
  }
  if (value === 'create_portal_session') {
    return 'billing_portal';
  }
  return 'paid_checkout';
};

const resolveBillingIntervalFromReuseKey = (reuseKey: string | null): 'month' | 'year' | null => {
  const lastSegment = reuseKey?.split(':').at(-1);
  return lastSegment === 'month' || lastSegment === 'year' ? lastSegment : null;
};

const toAttempt = (
  row: typeof dbSchema.organizationBillingOperationAttempt.$inferSelect,
): OrganizationBillingOperationAttempt => ({
  id: row.id,
  organizationId: row.organizationId,
  purpose: normalizePurpose(row.purpose),
  billingInterval: normalizeBillingInterval(row.billingInterval),
  state: normalizeState(row.state),
  handoffUrl: row.handoffUrl ?? null,
  handoffExpiresAt: row.handoffExpiresAt ?? null,
  provider: 'stripe',
  stripeCustomerId: row.stripeCustomerId ?? null,
  stripeSubscriptionId: row.stripeSubscriptionId ?? null,
  stripeCheckoutSessionId: row.stripeCheckoutSessionId ?? null,
  stripePortalSessionId: row.stripePortalSessionId ?? null,
  reuseKey: row.reuseKey as BillingOperationReuseKey | null,
  idempotencyKey: row.idempotencyKey,
  failureReason: row.failureReason ?? null,
  createdByUserId: row.createdByUserId ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * reserve-app の既存 operation purpose を、再利用可能な operation reuseKey へ対応させる。
 */
export const buildOrganizationBillingOperationReuseKey = ({
  organizationId,
  purpose,
  billingInterval,
  stripeSubscriptionId,
}: {
  organizationId: string;
  purpose: OrganizationBillingOperationPurpose;
  billingInterval?: 'month' | 'year' | null;
  stripeSubscriptionId?: string | null;
}): BillingOperationReuseKey => {
  if (purpose === 'trial_start') {
    return buildStartTrialSubscriptionReuseKey({
      subjectType: 'organization',
      subjectId: organizationId,
      planCode: 'premium',
    });
  }

  if (purpose === 'paid_checkout') {
    return buildSubscriptionCheckoutReuseKey({
      subjectType: 'organization',
      subjectId: organizationId,
      planCode: 'premium',
      interval: billingInterval ?? 'month',
    });
  }

  if (purpose === 'payment_method_setup') {
    return buildSetupCheckoutReuseKey({
      subjectType: 'organization',
      subjectId: organizationId,
    });
  }

  return buildPortalSessionReuseKey({
    subjectType: 'organization',
    subjectId: organizationId,
    flow: stripeSubscriptionId
      ? { type: 'subscription_update', subscriptionId: stripeSubscriptionId }
      : { type: 'default' },
  });
};

/**
 * operation attempt ごとの Stripe idempotency key を作る。
 */
export const buildBillingOperationIdempotencyKey = ({
  reuseKey,
  attemptNumber,
}: {
  reuseKey: BillingOperationReuseKey;
  attemptNumber: number;
}) => {
  return ['organization_billing_operation', reuseKey, String(attemptNumber)].join(':');
};

/**
 * まだ有効な handoff URL がある operation attempt を再利用し、Stripe session の重複作成を避ける。
 */
export const readReusableBillingOperationAttempt = async ({
  database,
  organizationId,
  purpose,
  billingInterval = null,
  reuseKey,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  purpose: OrganizationBillingOperationPurpose;
  billingInterval?: 'month' | 'year' | null;
  reuseKey?: BillingOperationReuseKey | null;
  now?: Date;
}) => {
  const rows = await database
    .select()
    .from(dbSchema.organizationBillingOperationAttempt)
    .where(
      and(
        eq(dbSchema.organizationBillingOperationAttempt.organizationId, organizationId),
        eq(dbSchema.organizationBillingOperationAttempt.purpose, purpose),
        billingInterval
          ? eq(dbSchema.organizationBillingOperationAttempt.billingInterval, billingInterval)
          : isNull(dbSchema.organizationBillingOperationAttempt.billingInterval),
        reuseKey
          ? eq(dbSchema.organizationBillingOperationAttempt.reuseKey, reuseKey)
          : or(
              isNull(dbSchema.organizationBillingOperationAttempt.reuseKey),
              eq(
                dbSchema.organizationBillingOperationAttempt.reuseKey,
                buildOrganizationBillingOperationReuseKey({
                  organizationId,
                  purpose,
                  billingInterval,
                }),
              ),
            ),
        gt(dbSchema.organizationBillingOperationAttempt.handoffExpiresAt, now),
      ),
    )
    .orderBy(desc(dbSchema.organizationBillingOperationAttempt.createdAt))
    .limit(5);

  const reusable = rows.find(
    (row: (typeof rows)[number]) =>
      (row.state === 'processing' || row.state === 'succeeded') &&
      row.handoffUrl &&
      row.handoffExpiresAt &&
      row.handoffExpiresAt.getTime() > now.getTime(),
  );
  return reusable ? toAttempt(reusable) : null;
};

const readFreshProcessingBillingOperationAttempt = async ({
  database,
  organizationId,
  purpose,
  billingInterval = null,
  reuseKey,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  purpose: OrganizationBillingOperationPurpose;
  billingInterval?: 'month' | 'year' | null;
  reuseKey: BillingOperationReuseKey;
  now?: Date;
}) => {
  const staleBefore = new Date(now.getTime() - BILLING_OPERATION_PENDING_STALE_MS);
  const rows = await database
    .select()
    .from(dbSchema.organizationBillingOperationAttempt)
    .where(
      and(
        eq(dbSchema.organizationBillingOperationAttempt.organizationId, organizationId),
        eq(dbSchema.organizationBillingOperationAttempt.purpose, purpose),
        billingInterval
          ? eq(dbSchema.organizationBillingOperationAttempt.billingInterval, billingInterval)
          : isNull(dbSchema.organizationBillingOperationAttempt.billingInterval),
        eq(dbSchema.organizationBillingOperationAttempt.reuseKey, reuseKey),
        eq(dbSchema.organizationBillingOperationAttempt.state, 'processing'),
        gt(dbSchema.organizationBillingOperationAttempt.createdAt, staleBefore),
      ),
    )
    .orderBy(desc(dbSchema.organizationBillingOperationAttempt.createdAt))
    .limit(1);

  return rows[0] ? toAttempt(rows[0]) : null;
};

const countBillingOperationAttemptsForReuseKey = async ({
  database,
  organizationId,
  reuseKey,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  reuseKey: BillingOperationReuseKey;
}) => {
  const rows = await database
    .select({ id: dbSchema.organizationBillingOperationAttempt.id })
    .from(dbSchema.organizationBillingOperationAttempt)
    .where(
      and(
        eq(dbSchema.organizationBillingOperationAttempt.organizationId, organizationId),
        eq(dbSchema.organizationBillingOperationAttempt.reuseKey, reuseKey),
      ),
    )
    .limit(100);

  return rows.length;
};

/**
 * Stripe handoff 操作を D1 上で claim する。
 *
 * 同一 window の idempotency key が競合した場合は、勝った attempt を再利用して呼び出し元に返す。
 */
export const createBillingOperationAttempt = async ({
  database,
  organizationId,
  purpose,
  billingInterval = null,
  reuseKey: requestedReuseKey,
  stripeSubscriptionId = null,
  createdByUserId = null,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  purpose: OrganizationBillingOperationPurpose;
  billingInterval?: 'month' | 'year' | null;
  reuseKey?: BillingOperationReuseKey | null;
  stripeSubscriptionId?: string | null;
  createdByUserId?: string | null;
  now?: Date;
}) => {
  const reuseKey =
    requestedReuseKey ??
    buildOrganizationBillingOperationReuseKey({
      organizationId,
      purpose,
      billingInterval,
      stripeSubscriptionId,
    });
  const existing = await readReusableBillingOperationAttempt({
    database,
    organizationId,
    purpose,
    billingInterval,
    reuseKey,
    now,
  });
  if (existing) {
    return {
      attempt: existing,
      reused: true,
    };
  }

  const freshProcessing = await readFreshProcessingBillingOperationAttempt({
    database,
    organizationId,
    purpose,
    billingInterval,
    reuseKey,
    now,
  });
  if (freshProcessing) {
    return {
      attempt: freshProcessing,
      reused: true,
    };
  }

  await database
    .update(dbSchema.organizationBillingOperationAttempt)
    .set({
      state: 'expired',
      failureReason: 'processing attempt exceeded freshness window',
      updatedAt: now,
    })
    .where(
      and(
        eq(dbSchema.organizationBillingOperationAttempt.organizationId, organizationId),
        eq(dbSchema.organizationBillingOperationAttempt.reuseKey, reuseKey),
        eq(dbSchema.organizationBillingOperationAttempt.state, 'processing'),
        lt(
          dbSchema.organizationBillingOperationAttempt.createdAt,
          new Date(now.getTime() - BILLING_OPERATION_PENDING_STALE_MS),
        ),
      ),
    );

  const attemptNumber =
    (await countBillingOperationAttemptsForReuseKey({
      database,
      organizationId,
      reuseKey,
    })) + 1;
  const idempotencyKey = buildBillingOperationIdempotencyKey({
    reuseKey,
    attemptNumber,
  });
  const insertedRows = await database
    .insert(dbSchema.organizationBillingOperationAttempt)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      purpose,
      billingInterval,
      state: 'processing',
      provider: 'stripe',
      reuseKey,
      idempotencyKey,
      createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (insertedRows[0]) {
    return {
      attempt: toAttempt(insertedRows[0]),
      reused: false,
    };
  }

  const rows = await database
    .select()
    .from(dbSchema.organizationBillingOperationAttempt)
    .where(eq(dbSchema.organizationBillingOperationAttempt.idempotencyKey, idempotencyKey))
    .limit(1);

  if (rows[0]) {
    return {
      attempt: toAttempt(rows[0]),
      reused: true,
    };
  }

  throw new Error('BILLING_OPERATION_ATTEMPT_CLAIM_FAILED');
};

/** Stripe 側の handoff 作成に成功した attempt に、URL と provider identifiers を保存する。 */
export const markBillingOperationAttemptSucceeded = async ({
  database,
  attemptId,
  handoffUrl,
  handoffExpiresAt,
  stripeCustomerId,
  stripeSubscriptionId,
  stripeCheckoutSessionId,
  stripePortalSessionId,
}: {
  database: AuthRuntimeDatabase;
  attemptId: string;
  handoffUrl?: string | null;
  handoffExpiresAt?: Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripePortalSessionId?: string | null;
}) => {
  const rows = await database
    .update(dbSchema.organizationBillingOperationAttempt)
    .set({
      state: 'succeeded',
      handoffUrl: handoffUrl ?? null,
      handoffExpiresAt: handoffExpiresAt ?? null,
      stripeCustomerId: stripeCustomerId ?? null,
      stripeSubscriptionId: stripeSubscriptionId ?? null,
      stripeCheckoutSessionId: stripeCheckoutSessionId ?? null,
      stripePortalSessionId: stripePortalSessionId ?? null,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(dbSchema.organizationBillingOperationAttempt.id, attemptId))
    .returning();

  return rows[0] ? toAttempt(rows[0]) : null;
};

/** handoff 作成に失敗した attempt を、owner UI と内部調査で読める状態に更新する。 */
export const markBillingOperationAttemptFailed = async ({
  database,
  attemptId,
  state = 'failed',
  failureReason,
}: {
  database: AuthRuntimeDatabase;
  attemptId: string;
  state?: Extract<OrganizationBillingOperationState, 'conflict' | 'expired' | 'failed'>;
  failureReason: string;
}) => {
  const rows = await database
    .update(dbSchema.organizationBillingOperationAttempt)
    .set({
      state,
      failureReason,
      updatedAt: new Date(),
    })
    .where(eq(dbSchema.organizationBillingOperationAttempt.id, attemptId))
    .returning();

  return rows[0] ? toAttempt(rows[0]) : null;
};

/** owner や internal inspection が参照する直近の billing handoff 履歴を返す。 */
export const readRecentBillingOperationAttempts = async ({
  database,
  organizationId,
  limit = 10,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  limit?: number;
}) => {
  const rows = await database
    .select({
      id: dbSchema.billingOperationAttempt.id,
      organizationId: dbSchema.billingAccount.subjectId,
      purpose: dbSchema.billingOperationAttempt.purpose,
      state: dbSchema.billingOperationAttempt.state,
      handoffUrl: dbSchema.billingOperationAttempt.handoffUrl,
      handoffExpiresAt: dbSchema.billingOperationAttempt.handoffExpiresAt,
      stripeCustomerId: dbSchema.billingOperationAttempt.providerCustomerId,
      stripeSubscriptionId: dbSchema.billingOperationAttempt.providerSubscriptionId,
      stripeCheckoutSessionId: dbSchema.billingOperationAttempt.providerCheckoutSessionId,
      stripePortalSessionId: dbSchema.billingOperationAttempt.providerPortalSessionId,
      reuseKey: dbSchema.billingOperationAttempt.reuseKey,
      idempotencyKey: dbSchema.billingOperationAttempt.idempotencyKey,
      failureReason: dbSchema.billingOperationAttempt.failureReason,
      createdByUserId: dbSchema.billingOperationAttempt.createdByUserId,
      createdAt: dbSchema.billingOperationAttempt.createdAt,
      updatedAt: dbSchema.billingOperationAttempt.updatedAt,
    })
    .from(dbSchema.billingOperationAttempt)
    .innerJoin(
      dbSchema.billingAccount,
      eq(dbSchema.billingOperationAttempt.billingAccountId, dbSchema.billingAccount.id),
    )
    .where(
      and(
        eq(dbSchema.billingAccount.subjectType, 'organization'),
        eq(dbSchema.billingAccount.subjectId, organizationId),
      ),
    )
    .orderBy(desc(dbSchema.billingOperationAttempt.createdAt))
    .limit(Math.max(1, Math.min(Math.trunc(limit), 50)));

  return rows.map(
    (row: (typeof rows)[number]): OrganizationBillingOperationAttempt => ({
      id: row.id,
      organizationId: row.organizationId,
      purpose: normalizeGenericPurpose(row.purpose),
      billingInterval: resolveBillingIntervalFromReuseKey(row.reuseKey),
      state: normalizeState(row.state),
      handoffUrl: row.handoffUrl ?? null,
      handoffExpiresAt: row.handoffExpiresAt ?? null,
      provider: 'stripe',
      stripeCustomerId: row.stripeCustomerId ?? null,
      stripeSubscriptionId: row.stripeSubscriptionId ?? null,
      stripeCheckoutSessionId: row.stripeCheckoutSessionId ?? null,
      stripePortalSessionId: row.stripePortalSessionId ?? null,
      reuseKey: row.reuseKey as BillingOperationReuseKey | null,
      idempotencyKey: row.idempotencyKey,
      failureReason: row.failureReason ?? null,
      createdByUserId: row.createdByUserId ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }),
  );
};
