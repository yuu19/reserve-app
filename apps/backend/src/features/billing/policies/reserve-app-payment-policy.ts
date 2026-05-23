import type { AuthRuntimeEnv } from '../../../auth-runtime.js';
import { readStripeCustomerSummary } from '../../../infra/payment/stripe.js';

export const RESERVE_APP_PREMIUM_TRIAL_DURATION_DAYS = 7;
export const RESERVE_APP_BILLING_PAST_DUE_GRACE_DAYS = 7;
export const RESERVE_APP_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE =
  'Organization already has an active premium trial or paid subscription.';
export const RESERVE_APP_PREMIUM_TRIAL_COMPLETION_CONFLICT_MESSAGE =
  'Organization does not have an active premium trial.';
export const RESERVE_APP_PREMIUM_TRIAL_COMPLETION_NOT_READY_MESSAGE =
  'Organization premium trial has not reached its completion time yet.';
export const RESERVE_APP_PREMIUM_TRIAL_COMPLETION_PENDING_MESSAGE =
  'Payment method status is still syncing with Stripe. Retry after billing synchronization completes.';

export type ReserveAppBillingPlanCode = 'free' | 'premium';
export type ReserveAppBillingSubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';
export type ReserveAppBillingPlanState = 'free' | 'premium_trial' | 'premium_paid';
export type ReserveAppBillingPaymentMethodStatus = 'not_started' | 'pending' | 'registered';
export type ReserveAppBillingPaymentIssueState =
  | 'none'
  | 'payment_failed'
  | 'payment_action_required'
  | 'past_due_grace_active'
  | 'past_due_grace_expired'
  | 'unpaid'
  | 'incomplete'
  | 'recovered'
  | 'stale_failure_history_only';
export type ReserveAppBillingPaymentIssueStartedAtSource =
  | 'provider_issue_time'
  | 'application_receipt_time'
  | 'none';
export type ReserveAppBillingPaymentIssueTiming = {
  issueStartedAt: string | null;
  issueStartedAtSource: ReserveAppBillingPaymentIssueStartedAtSource;
  graceEndsAt: string | null;
};
export type ReserveAppBillingPaymentMethodReason =
  | 'plan_is_free'
  | 'missing_customer'
  | 'missing_default_payment_method'
  | 'default_payment_method_registered'
  | 'stripe_not_configured'
  | 'stripe_lookup_failed';

export type ReserveAppBillingPaymentMethodEvaluation = {
  status: ReserveAppBillingPaymentMethodStatus;
  reason: ReserveAppBillingPaymentMethodReason;
};

type ReserveAppBillingPaymentIssueEventType =
  | 'payment_failed'
  | 'payment_action_required'
  | 'payment_succeeded'
  | null;

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

const toTime = (value: string | Date | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

export const resolveReserveAppBillingPaymentIssueTiming = ({
  paymentIssueStartedAt,
  pastDueGraceEndsAt,
  providerIssueStartedAt,
}: {
  paymentIssueStartedAt?: Date | string | null;
  pastDueGraceEndsAt?: Date | string | null;
  providerIssueStartedAt?: Date | string | null;
}): ReserveAppBillingPaymentIssueTiming => {
  const issueStartedAt = toIsoDateString(paymentIssueStartedAt);
  const graceEndsAt = toIsoDateString(pastDueGraceEndsAt);
  const issueTime = toTime(issueStartedAt);
  const providerTime = toTime(providerIssueStartedAt ?? null);
  const issueStartedAtSource: ReserveAppBillingPaymentIssueStartedAtSource = !issueStartedAt
    ? 'none'
    : providerTime !== null && issueTime === providerTime
      ? 'provider_issue_time'
      : 'application_receipt_time';

  return {
    issueStartedAt,
    issueStartedAtSource,
    graceEndsAt,
  };
};

export const resolveReserveAppBillingPaymentIssueState = ({
  subscriptionStatus,
  entitlementReason,
  latestPaymentIssueEventType = null,
  hasRecoveredPaymentIssueHistory = false,
  hasStaleFailureHistory = false,
}: {
  subscriptionStatus: ReserveAppBillingSubscriptionStatus;
  entitlementReason?: string | null;
  latestPaymentIssueEventType?: ReserveAppBillingPaymentIssueEventType;
  hasRecoveredPaymentIssueHistory?: boolean;
  hasStaleFailureHistory?: boolean;
}): ReserveAppBillingPaymentIssueState => {
  if (subscriptionStatus === 'past_due') {
    return entitlementReason === 'premium_paid_past_due_grace_active'
      ? 'past_due_grace_active'
      : 'past_due_grace_expired';
  }

  if (subscriptionStatus === 'unpaid') {
    return 'unpaid';
  }

  if (subscriptionStatus === 'incomplete') {
    return 'incomplete';
  }

  if (hasStaleFailureHistory) {
    return 'stale_failure_history_only';
  }

  if (latestPaymentIssueEventType === 'payment_succeeded' && hasRecoveredPaymentIssueHistory) {
    return 'recovered';
  }

  if (latestPaymentIssueEventType === 'payment_action_required') {
    return 'payment_action_required';
  }

  if (latestPaymentIssueEventType === 'payment_failed') {
    return 'payment_failed';
  }

  return 'none';
};

export const isReserveAppBillingInterval = (value: string | null): 'month' | 'year' | null => {
  if (value === 'month' || value === 'year') {
    return value;
  }
  return null;
};

export const isReserveAppBillingSubscriptionStatus = (
  value: string | null,
): ReserveAppBillingSubscriptionStatus | null => {
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
  return null;
};

export const hasActiveReserveAppPremiumSubscription = (value: string | null): boolean => {
  return (
    value === 'trialing' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'unpaid' ||
    value === 'incomplete'
  );
};

export const resolveReserveAppBillingPlanState = ({
  planCode,
  subscriptionStatus,
}: {
  planCode: ReserveAppBillingPlanCode;
  subscriptionStatus: ReserveAppBillingSubscriptionStatus;
}): ReserveAppBillingPlanState => {
  if (planCode !== 'premium') {
    return 'free';
  }

  return subscriptionStatus === 'trialing' ? 'premium_trial' : 'premium_paid';
};

export const resolveReserveAppBillingTrialEndsAt = ({
  planState,
  currentPeriodEnd,
}: {
  planState: ReserveAppBillingPlanState;
  currentPeriodEnd: string | null;
}): string | null => {
  return planState === 'premium_trial' ? currentPeriodEnd : null;
};

export const resolveReserveAppBillingPaymentMethodEvaluation = async ({
  env,
  planCode,
  stripeCustomerId,
}: {
  env: AuthRuntimeEnv;
  planCode: ReserveAppBillingPlanCode;
  stripeCustomerId: string | null;
}): Promise<ReserveAppBillingPaymentMethodEvaluation> => {
  if (planCode !== 'premium') {
    return {
      status: 'not_started',
      reason: 'plan_is_free',
    };
  }

  if (!stripeCustomerId) {
    return {
      status: 'not_started',
      reason: 'missing_customer',
    };
  }

  if (!env.STRIPE_SECRET_KEY?.trim()) {
    return {
      status: 'pending',
      reason: 'stripe_not_configured',
    };
  }

  try {
    const customer = await readStripeCustomerSummary({
      env,
      customerId: stripeCustomerId,
    });
    if (customer.defaultPaymentMethodId) {
      return {
        status: 'registered',
        reason: 'default_payment_method_registered',
      };
    }

    return {
      status: 'pending',
      reason: 'missing_default_payment_method',
    };
  } catch {
    return {
      status: 'pending',
      reason: 'stripe_lookup_failed',
    };
  }
};

export const resolveReserveAppBillingPaymentMethodStatus = async ({
  env,
  planCode,
  stripeCustomerId,
}: {
  env: AuthRuntimeEnv;
  planCode: ReserveAppBillingPlanCode;
  stripeCustomerId: string | null;
}): Promise<ReserveAppBillingPaymentMethodStatus> => {
  const paymentMethod = await resolveReserveAppBillingPaymentMethodEvaluation({
    env,
    planCode,
    stripeCustomerId,
  });

  return paymentMethod.status;
};
