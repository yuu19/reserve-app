import { eq, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import {
  resolveOrganizationBillingPaymentMethodStatus,
  selectOrganizationBillingSummary,
  type OrganizationBillingPaymentMethodStatus,
  type OrganizationBillingPlanCode,
  type OrganizationBillingPlanState,
  type OrganizationBillingSubscriptionStatus,
} from './organization-billing.js';
import {
  resolveOrganizationPremiumEntitlementPolicy,
  type OrganizationBillingEntitlementState,
} from './organization-billing-policy.js';
import type { StripeSubscriptionSummary } from '../payment/stripe.js';

export type OrganizationBillingObservationSnapshot = {
  planCode: OrganizationBillingPlanCode;
  planState: OrganizationBillingPlanState;
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
  paymentMethodStatus: OrganizationBillingPaymentMethodStatus;
  entitlementState: OrganizationBillingEntitlementState;
  billingInterval: 'month' | 'year' | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
};

export type OrganizationBillingAuditSourceKind =
  | 'trial_start'
  | 'payment_method_customer_linked'
  | 'trial_completion'
  | 'webhook_checkout_completed'
  | 'webhook_subscription_lifecycle'
  | 'webhook_trial_completion';

export type OrganizationBillingSignalKind = 'reconciliation' | 'notification_delivery';
export type OrganizationBillingSignalStatus = 'pending' | 'mismatch' | 'unavailable' | 'resolved';

const resolveProviderPlanState = (
  subscriptionStatus: string | null,
): OrganizationBillingPlanState | null => {
  if (subscriptionStatus === 'trialing') {
    return 'premium_trial';
  }
  if (
    subscriptionStatus === 'active'
    || subscriptionStatus === 'past_due'
    || subscriptionStatus === 'unpaid'
    || subscriptionStatus === 'incomplete'
  ) {
    return 'premium_paid';
  }
  if (subscriptionStatus === 'canceled') {
    return 'free';
  }
  return null;
};

const selectNextBillingAuditSequenceNumber = async ({
  database,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
}) => {
  const rows = await database
    .select({
      maxSequenceNumber:
        sql<number>`coalesce(max(${dbSchema.organizationBillingAuditEvent.sequenceNumber}), 0)`,
    })
    .from(dbSchema.organizationBillingAuditEvent)
    .where(eq(dbSchema.organizationBillingAuditEvent.organizationId, organizationId));

  return Number(rows[0]?.maxSequenceNumber ?? 0) + 1;
};

const selectNextBillingSignalSequenceNumber = async ({
  database,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
}) => {
  const rows = await database
    .select({
      maxSequenceNumber:
        sql<number>`coalesce(max(${dbSchema.organizationBillingSignal.sequenceNumber}), 0)`,
    })
    .from(dbSchema.organizationBillingSignal)
    .where(eq(dbSchema.organizationBillingSignal.organizationId, organizationId));

  return Number(rows[0]?.maxSequenceNumber ?? 0) + 1;
};

const areBillingSnapshotsEqual = (
  previousSnapshot: OrganizationBillingObservationSnapshot,
  nextSnapshot: OrganizationBillingObservationSnapshot,
) => {
  return (
    previousSnapshot.planCode === nextSnapshot.planCode
    && previousSnapshot.planState === nextSnapshot.planState
    && previousSnapshot.subscriptionStatus === nextSnapshot.subscriptionStatus
    && previousSnapshot.paymentMethodStatus === nextSnapshot.paymentMethodStatus
    && previousSnapshot.entitlementState === nextSnapshot.entitlementState
    && previousSnapshot.billingInterval === nextSnapshot.billingInterval
    && previousSnapshot.stripeCustomerId === nextSnapshot.stripeCustomerId
    && previousSnapshot.stripeSubscriptionId === nextSnapshot.stripeSubscriptionId
    && previousSnapshot.stripePriceId === nextSnapshot.stripePriceId
  );
};

export const readOrganizationBillingObservationSnapshot = async ({
  database,
  env,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
}) => {
  const billing = await selectOrganizationBillingSummary(database, organizationId);
  const planCode: OrganizationBillingPlanCode = billing?.planCode === 'premium' ? 'premium' : 'free';
  const billingInterval = billing?.billingInterval === 'month' || billing?.billingInterval === 'year'
    ? billing.billingInterval
    : null;
  const subscriptionStatus: OrganizationBillingSubscriptionStatus =
    billing?.subscriptionStatus === 'trialing'
    || billing?.subscriptionStatus === 'active'
    || billing?.subscriptionStatus === 'past_due'
    || billing?.subscriptionStatus === 'canceled'
    || billing?.subscriptionStatus === 'unpaid'
    || billing?.subscriptionStatus === 'incomplete'
      ? billing.subscriptionStatus
      : 'free';
  const paymentMethodStatus = await resolveOrganizationBillingPaymentMethodStatus({
    env,
    planCode,
    stripeCustomerId: billing?.stripeCustomerId ?? null,
  });
  const policy = resolveOrganizationPremiumEntitlementPolicy({
    planCode,
    subscriptionStatus,
    paymentMethodStatus,
    currentPeriodEnd:
      billing?.currentPeriodEnd instanceof Date ? billing.currentPeriodEnd.toISOString() : null,
  });

  return {
    planCode,
    planState: policy.planState,
    subscriptionStatus,
    paymentMethodStatus: policy.paymentMethodStatus,
    entitlementState: policy.entitlementState,
    billingInterval,
    stripeCustomerId: billing?.stripeCustomerId ?? null,
    stripeSubscriptionId: billing?.stripeSubscriptionId ?? null,
    stripePriceId: billing?.stripePriceId ?? null,
  } satisfies OrganizationBillingObservationSnapshot;
};

export const appendOrganizationBillingAuditEvent = async ({
  database,
  organizationId,
  sourceKind,
  previousSnapshot,
  nextSnapshot,
  stripeEventId,
  sourceContext,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  sourceKind: OrganizationBillingAuditSourceKind;
  previousSnapshot: OrganizationBillingObservationSnapshot;
  nextSnapshot: OrganizationBillingObservationSnapshot;
  stripeEventId?: string | null;
  sourceContext?: string | null;
}) => {
  if (areBillingSnapshotsEqual(previousSnapshot, nextSnapshot)) {
    return false;
  }

  const sequenceNumber = await selectNextBillingAuditSequenceNumber({
    database,
    organizationId,
  });

  await database.insert(dbSchema.organizationBillingAuditEvent).values({
    id: crypto.randomUUID(),
    organizationId,
    sequenceNumber,
    sourceKind,
    stripeEventId: stripeEventId ?? null,
    stripeCustomerId: nextSnapshot.stripeCustomerId ?? previousSnapshot.stripeCustomerId,
    stripeSubscriptionId:
      nextSnapshot.stripeSubscriptionId ?? previousSnapshot.stripeSubscriptionId,
    sourceContext: sourceContext ?? null,
    previousPlanCode: previousSnapshot.planCode,
    nextPlanCode: nextSnapshot.planCode,
    previousPlanState: previousSnapshot.planState,
    nextPlanState: nextSnapshot.planState,
    previousSubscriptionStatus: previousSnapshot.subscriptionStatus,
    nextSubscriptionStatus: nextSnapshot.subscriptionStatus,
    previousPaymentMethodStatus: previousSnapshot.paymentMethodStatus,
    nextPaymentMethodStatus: nextSnapshot.paymentMethodStatus,
    previousEntitlementState: previousSnapshot.entitlementState,
    nextEntitlementState: nextSnapshot.entitlementState,
    previousBillingInterval: previousSnapshot.billingInterval,
    nextBillingInterval: nextSnapshot.billingInterval,
  });

  return true;
};

export const appendOrganizationBillingSignal = async ({
  database,
  organizationId,
  signalKind,
  signalStatus,
  sourceKind,
  reason,
  appSnapshot,
  stripeEventId,
  stripeCustomerId,
  stripeSubscriptionId,
  providerPlanState,
  providerSubscriptionStatus,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  signalKind: OrganizationBillingSignalKind;
  signalStatus: OrganizationBillingSignalStatus;
  sourceKind: string;
  reason: string;
  appSnapshot: OrganizationBillingObservationSnapshot;
  stripeEventId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  providerPlanState?: OrganizationBillingPlanState | null;
  providerSubscriptionStatus?: string | null;
}) => {
  const sequenceNumber = await selectNextBillingSignalSequenceNumber({
    database,
    organizationId,
  });

  await database.insert(dbSchema.organizationBillingSignal).values({
    id: crypto.randomUUID(),
    organizationId,
    sequenceNumber,
    signalKind,
    signalStatus,
    sourceKind,
    reason,
    stripeEventId: stripeEventId ?? null,
    stripeCustomerId: stripeCustomerId ?? appSnapshot.stripeCustomerId,
    stripeSubscriptionId: stripeSubscriptionId ?? appSnapshot.stripeSubscriptionId,
    providerPlanState: providerPlanState ?? null,
    providerSubscriptionStatus: providerSubscriptionStatus ?? null,
    appPlanState: appSnapshot.planState,
    appSubscriptionStatus: appSnapshot.subscriptionStatus,
    appPaymentMethodStatus: appSnapshot.paymentMethodStatus,
    appEntitlementState: appSnapshot.entitlementState,
  });
};

export const appendResolvedBillingSignalIfNeeded = async ({
  database,
  organizationId,
  signalKind,
  sourceKind,
  reason,
  appSnapshot,
  stripeEventId,
  stripeCustomerId,
  stripeSubscriptionId,
  providerPlanState,
  providerSubscriptionStatus,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  signalKind: OrganizationBillingSignalKind;
  sourceKind: string;
  reason: string;
  appSnapshot: OrganizationBillingObservationSnapshot;
  stripeEventId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  providerPlanState?: OrganizationBillingPlanState | null;
  providerSubscriptionStatus?: string | null;
}) => {
  const latestSignal = await database
    .select({
      signalStatus: dbSchema.organizationBillingSignal.signalStatus,
      signalKind: dbSchema.organizationBillingSignal.signalKind,
    })
    .from(dbSchema.organizationBillingSignal)
    .where(eq(dbSchema.organizationBillingSignal.organizationId, organizationId))
    .orderBy(sql`${dbSchema.organizationBillingSignal.sequenceNumber} desc`)
    .limit(20);

  const latestSameKind = latestSignal.find(
    (row: { signalKind: OrganizationBillingSignalKind; signalStatus: OrganizationBillingSignalStatus }) =>
      row.signalKind === signalKind,
  );
  if (
    !latestSameKind
    || (
      latestSameKind.signalStatus !== 'pending'
      && latestSameKind.signalStatus !== 'mismatch'
      && latestSameKind.signalStatus !== 'unavailable'
    )
  ) {
    return false;
  }

  await appendOrganizationBillingSignal({
    database,
    organizationId,
    signalKind,
    signalStatus: 'resolved',
    sourceKind,
    reason,
    appSnapshot,
    stripeEventId,
    stripeCustomerId,
    stripeSubscriptionId,
    providerPlanState,
    providerSubscriptionStatus,
  });
  return true;
};

export const evaluateReconciliationMismatchReason = ({
  appSnapshot,
  providerSubscription,
}: {
  appSnapshot: OrganizationBillingObservationSnapshot;
  providerSubscription: StripeSubscriptionSummary;
}) => {
  const providerPlanState = resolveProviderPlanState(providerSubscription.status);
  if (!providerPlanState) {
    return {
      providerPlanState: null,
      reason: 'provider_subscription_status_unknown',
    };
  }

  if (appSnapshot.planState !== providerPlanState) {
    return {
      providerPlanState,
      reason: 'plan_state_mismatch',
    };
  }

  if (appSnapshot.subscriptionStatus !== providerSubscription.status) {
    return {
      providerPlanState,
      reason: 'subscription_status_mismatch',
    };
  }

  if (
    providerSubscription.customerId
    && appSnapshot.stripeCustomerId
    && providerSubscription.customerId !== appSnapshot.stripeCustomerId
  ) {
    return {
      providerPlanState,
      reason: 'stripe_customer_id_mismatch',
    };
  }

  if (
    providerPlanState !== 'free'
    && providerSubscription.id !== appSnapshot.stripeSubscriptionId
  ) {
    return {
      providerPlanState,
      reason: 'stripe_subscription_id_mismatch',
    };
  }

  return {
    providerPlanState,
    reason: null,
  };
};
