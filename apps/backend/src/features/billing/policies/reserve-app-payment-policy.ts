import type { AuthRuntimeEnv } from '../../../auth-runtime.js';
import { readStripeCustomerSummary } from '../../../infra/payment/stripe.js';

/** Reserve App Premium trial の既定期間。単位は days。 */
export const RESERVE_APP_PREMIUM_TRIAL_DURATION_DAYS = 7;

/** Past due のまま Reserve App Premium entitlement を猶予する期間。単位は days。 */
export const RESERVE_APP_BILLING_PAST_DUE_GRACE_DAYS = 7;

/** Trial または有料 subscription が既にある場合に返す lifecycle conflict message。 */
export const RESERVE_APP_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE =
  'Organization already has an active premium trial or paid subscription.';

/** Trial completion 対象の active trial がない場合に返す conflict message。 */
export const RESERVE_APP_PREMIUM_TRIAL_COMPLETION_CONFLICT_MESSAGE =
  'Organization does not have an active premium trial.';

/** Trial 終了時刻に達していない場合に返す not-ready message。 */
export const RESERVE_APP_PREMIUM_TRIAL_COMPLETION_NOT_READY_MESSAGE =
  'Organization premium trial has not reached its completion time yet.';

/** Stripe payment method 反映待ちの trial completion retry message。 */
export const RESERVE_APP_PREMIUM_TRIAL_COMPLETION_PENDING_MESSAGE =
  'Payment method status is still syncing with Stripe. Retry after billing synchronization completes.';

/** Reserve App billing が扱う plan code。 */
export type ReserveAppBillingPlanCode = 'free' | 'premium';

/** Stripe と application aggregate をまたいで扱う subscription status。 */
export type ReserveAppBillingSubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';

/** Owner UI と entitlement policy が表示する plan lifecycle state。 */
export type ReserveAppBillingPlanState = 'free' | 'premium_trial' | 'premium_paid';

/** Trial 完了や CTA 表示で使う支払い方法登録状態。 */
export type ReserveAppBillingPaymentMethodStatus = 'not_started' | 'pending' | 'registered';

/** Owner UI と internal inspection が共有する支払い問題 state。 */
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

/** 支払い問題開始時刻が provider 由来か application 受領時刻由来かを表す値。 */
export type ReserveAppBillingPaymentIssueStartedAtSource =
  | 'provider_issue_time'
  | 'application_receipt_time'
  | 'none';

/** 支払い問題の開始時刻と猶予期限を owner 表示向けにまとめた型。 */
export type ReserveAppBillingPaymentIssueTiming = {
  issueStartedAt: string | null;
  issueStartedAtSource: ReserveAppBillingPaymentIssueStartedAtSource;
  graceEndsAt: string | null;
};

/** 支払い方法登録状態を判定した理由。 */
export type ReserveAppBillingPaymentMethodReason =
  | 'plan_is_free'
  | 'missing_customer'
  | 'missing_default_payment_method'
  | 'default_payment_method_registered'
  | 'stripe_not_configured'
  | 'stripe_lookup_failed';

/** 支払い方法登録状態とその根拠を組み合わせた評価結果。 */
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

/** 支払い失敗の起点時刻と猶予期限を、provider 時刻とアプリ受領時刻のどちら由来か判別できる形で返す。 */
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

/**
 * Subscription status と直近の invoice/payment event から、owner 向けに表示する支払い問題状態を決める。
 */
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

/** Stripe price や DB 値から billing interval として扱える値だけを正規化する。 */
export const isReserveAppBillingInterval = (value: string | null): 'month' | 'year' | null => {
  if (value === 'month' || value === 'year') {
    return value;
  }
  return null;
};

/** 不明な文字列を除外し、billing subscription status として扱える値だけを返す。 */
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

/** Premium entitlement と provider handoff の対象になる active 系 subscription status かを判定する。 */
export const hasActiveReserveAppPremiumSubscription = (value: string | null): boolean => {
  return (
    value === 'trialing' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'unpaid' ||
    value === 'incomplete'
  );
};

/** Plan code と subscription status から owner UI の plan lifecycle state を解決する。 */
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

/** Trial 中の場合だけ current period end を trial end として返す。 */
export const resolveReserveAppBillingTrialEndsAt = ({
  planState,
  currentPeriodEnd,
}: {
  planState: ReserveAppBillingPlanState;
  currentPeriodEnd: string | null;
}): string | null => {
  return planState === 'premium_trial' ? currentPeriodEnd : null;
};

/**
 * Stripe customer の default payment method を読み、trial 終了や CTA 表示に使う支払い方法状態を評価する。
 *
 * Stripe 未設定・一時的な lookup 失敗は、即時失格ではなく pending として扱う。
 */
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

/** 支払い方法評価結果から owner UI が使う状態値だけを返す。 */
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
