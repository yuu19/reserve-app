import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';

export const BILLING_HANDOFF_REUSE_WINDOW_MS = 30 * 60 * 1000;

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
  idempotencyKey: row.idempotencyKey,
  failureReason: row.failureReason ?? null,
  createdByUserId: row.createdByUserId ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const buildBillingOperationIdempotencyKey = ({
  organizationId,
  purpose,
  billingInterval,
  now = new Date(),
}: {
  organizationId: string;
  purpose: OrganizationBillingOperationPurpose;
  billingInterval?: 'month' | 'year' | null;
  now?: Date;
}) => {
  const windowStart = Math.floor(now.getTime() / BILLING_HANDOFF_REUSE_WINDOW_MS);
  return [
    'organization_billing_operation',
    organizationId,
    purpose,
    billingInterval ?? 'none',
    String(windowStart),
  ].join(':');
};

export const readReusableBillingOperationAttempt = async ({
  database,
  organizationId,
  purpose,
  billingInterval = null,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  purpose: OrganizationBillingOperationPurpose;
  billingInterval?: 'month' | 'year' | null;
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

export const createBillingOperationAttempt = async ({
  database,
  organizationId,
  purpose,
  billingInterval = null,
  createdByUserId = null,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  purpose: OrganizationBillingOperationPurpose;
  billingInterval?: 'month' | 'year' | null;
  createdByUserId?: string | null;
  now?: Date;
}) => {
  const existing = await readReusableBillingOperationAttempt({
    database,
    organizationId,
    purpose,
    billingInterval,
    now,
  });
  if (existing) {
    return {
      attempt: existing,
      reused: true,
    };
  }

  const idempotencyKey = buildBillingOperationIdempotencyKey({
    organizationId,
    purpose,
    billingInterval,
    now,
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
    .select()
    .from(dbSchema.organizationBillingOperationAttempt)
    .where(eq(dbSchema.organizationBillingOperationAttempt.organizationId, organizationId))
    .orderBy(desc(dbSchema.organizationBillingOperationAttempt.createdAt))
    .limit(Math.max(1, Math.min(Math.trunc(limit), 50)));

  return rows.map(toAttempt);
};
