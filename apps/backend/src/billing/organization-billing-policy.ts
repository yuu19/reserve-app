import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import {
  resolveOrganizationBillingPaymentMethodStatus,
  resolveOrganizationBillingPlanState,
  resolveOrganizationBillingTrialEndsAt,
  selectOrganizationBillingSummary,
  type OrganizationBillingPaymentMethodStatus,
  type OrganizationBillingPlanCode,
  type OrganizationBillingPlanState,
  type OrganizationBillingSubscriptionStatus,
} from './organization-billing.js';

export type OrganizationBillingEntitlementState = 'free_only' | 'premium_enabled';

export type OrganizationPremiumEntitlementReason =
  | 'organization_plan_is_free'
  | 'premium_trial_active'
  | 'premium_trial_active_with_payment_method_registered'
  | 'premium_trial_missing_end'
  | 'premium_trial_expired'
  | 'premium_paid_active'
  | 'premium_paid_grace_state'
  | 'premium_paid_state_unexpected';

export type OrganizationPremiumEntitlementPolicyInput = {
  planCode: OrganizationBillingPlanCode;
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
  paymentMethodStatus: OrganizationBillingPaymentMethodStatus;
  currentPeriodEnd: string | null;
  now?: Date;
};

export type OrganizationPremiumEntitlementPolicyResult = {
  scope: 'organization';
  source: 'application_billing_state';
  planState: OrganizationBillingPlanState;
  paymentMethodStatus: OrganizationBillingPaymentMethodStatus;
  trialEndsAt: string | null;
  entitlementState: OrganizationBillingEntitlementState;
  isPremiumEligible: boolean;
  reason: OrganizationPremiumEntitlementReason;
};

const premiumPaidGraceStatuses = new Set<OrganizationBillingSubscriptionStatus>([
  'past_due',
  'unpaid',
  'incomplete',
]);

export const resolveOrganizationPremiumEntitlementPolicy = ({
  planCode,
  subscriptionStatus,
  paymentMethodStatus,
  currentPeriodEnd,
  now = new Date(),
}: OrganizationPremiumEntitlementPolicyInput): OrganizationPremiumEntitlementPolicyResult => {
  const planState = resolveOrganizationBillingPlanState({
    planCode,
    subscriptionStatus,
  });
  const trialEndsAt = resolveOrganizationBillingTrialEndsAt({
    planState,
    currentPeriodEnd,
  });

  if (planState === 'free') {
    return {
      scope: 'organization',
      source: 'application_billing_state',
      planState,
      paymentMethodStatus,
      trialEndsAt,
      entitlementState: 'free_only',
      isPremiumEligible: false,
      reason: 'organization_plan_is_free',
    };
  }

  if (planState === 'premium_trial') {
    if (!trialEndsAt) {
      return {
        scope: 'organization',
        source: 'application_billing_state',
        planState,
        paymentMethodStatus,
        trialEndsAt,
        entitlementState: 'free_only',
        isPremiumEligible: false,
        reason: 'premium_trial_missing_end',
      };
    }

    if (new Date(trialEndsAt).getTime() <= now.getTime()) {
      return {
        scope: 'organization',
        source: 'application_billing_state',
        planState,
        paymentMethodStatus,
        trialEndsAt,
        entitlementState: 'free_only',
        isPremiumEligible: false,
        reason: 'premium_trial_expired',
      };
    }

    return {
      scope: 'organization',
      source: 'application_billing_state',
      planState,
      paymentMethodStatus,
      trialEndsAt,
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason:
        paymentMethodStatus === 'registered'
          ? 'premium_trial_active_with_payment_method_registered'
          : 'premium_trial_active',
    };
  }

  if (subscriptionStatus === 'active') {
    return {
      scope: 'organization',
      source: 'application_billing_state',
      planState,
      paymentMethodStatus,
      trialEndsAt,
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_paid_active',
    };
  }

  if (premiumPaidGraceStatuses.has(subscriptionStatus)) {
    return {
      scope: 'organization',
      source: 'application_billing_state',
      planState,
      paymentMethodStatus,
      trialEndsAt,
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_paid_grace_state',
    };
  }

  return {
    scope: 'organization',
    source: 'application_billing_state',
    planState,
    paymentMethodStatus,
    trialEndsAt,
    entitlementState: 'free_only',
    isPremiumEligible: false,
    reason: 'premium_paid_state_unexpected',
  };
};

export const readOrganizationPremiumEntitlementPolicy = async ({
  database,
  env,
  organizationId,
  now,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  now?: Date;
}) => {
  const billing = await selectOrganizationBillingSummary(database, organizationId);
  const planCode: OrganizationBillingPlanCode = billing?.planCode === 'premium' ? 'premium' : 'free';
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

  return resolveOrganizationPremiumEntitlementPolicy({
    planCode,
    subscriptionStatus,
    paymentMethodStatus,
    currentPeriodEnd:
      billing?.currentPeriodEnd instanceof Date ? billing.currentPeriodEnd.toISOString() : null,
    now,
  });
};
