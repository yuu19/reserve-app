import {
  buildPortalSessionReuseKey,
  buildSetupCheckoutReuseKey,
  buildStartTrialSubscriptionReuseKey,
  buildSubscriptionCheckoutReuseKey,
  type BillingOperationReuseKey,
} from '@repo/saas-billing-core';
import { and, desc, eq } from 'drizzle-orm';
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

const normalizeState = (value: string): OrganizationBillingOperationState =>
  value === 'processing' ||
  value === 'succeeded' ||
  value === 'conflict' ||
  value === 'expired' ||
  value === 'failed'
    ? value
    : 'failed';

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
