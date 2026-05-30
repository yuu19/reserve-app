import type { AuthRuntimeEnv } from '../../auth-runtime.js';
import { readStripeCustomerSummary } from '../../infra/payment/stripe.js';
import {
  buildBillingProfileReadiness,
  type OrganizationBillingProfileReadiness,
} from './organization-billing-profile.js';

/** Organization Premium trial の既定期間。単位は days。 */
export const ORGANIZATION_PREMIUM_TRIAL_DURATION_DAYS = 7;

/** Past due のまま Premium entitlement を猶予する期間。単位は days。 */
export const ORGANIZATION_BILLING_PAST_DUE_GRACE_DAYS = 7;

/** Trial または有料 subscription が既にある場合に返す lifecycle conflict message。 */
export const ORGANIZATION_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE =
  'Organization already has an active premium trial or paid subscription.';

/** Trial completion 対象の active trial がない場合に返す conflict message。 */
export const ORGANIZATION_PREMIUM_TRIAL_COMPLETION_CONFLICT_MESSAGE =
  'Organization does not have an active premium trial.';

/** Trial 終了時刻に達していない場合に返す not-ready message。 */
export const ORGANIZATION_PREMIUM_TRIAL_COMPLETION_NOT_READY_MESSAGE =
  'Organization premium trial has not reached its completion time yet.';

/** Stripe payment method 反映待ちの trial completion retry message。 */
export const ORGANIZATION_PREMIUM_TRIAL_COMPLETION_PENDING_MESSAGE =
  'Payment method status is still syncing with Stripe. Retry after billing synchronization completes.';

/** Organization billing が扱う plan code。 */
export type OrganizationBillingPlanCode = 'free' | 'premium';

/** Stripe と application aggregate をまたいで扱う subscription status。 */
export type OrganizationBillingSubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';

/** Owner UI と entitlement policy が表示する plan lifecycle state。 */
export type OrganizationBillingPlanState = 'free' | 'premium_trial' | 'premium_paid';

/** Trial 完了や CTA 表示で使う支払い方法登録状態。 */
export type OrganizationBillingPaymentMethodStatus = 'not_started' | 'pending' | 'registered';

/** Owner UI と internal inspection が共有する支払い問題 state。 */
export type OrganizationBillingPaymentIssueState =
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
export type OrganizationBillingPaymentIssueStartedAtSource =
  | 'provider_issue_time'
  | 'application_receipt_time'
  | 'none';

/** 支払い問題の開始時刻と猶予期限を owner 表示向けにまとめた型。 */
export type OrganizationBillingPaymentIssueTiming = {
  issueStartedAt: string | null;
  issueStartedAtSource: OrganizationBillingPaymentIssueStartedAtSource;
  graceEndsAt: string | null;
};

/** 支払い方法登録状態を判定した理由。 */
export type OrganizationBillingPaymentMethodReason =
  | 'plan_is_free'
  | 'missing_customer'
  | 'missing_default_payment_method'
  | 'default_payment_method_registered'
  | 'stripe_not_configured'
  | 'stripe_lookup_failed';

/** 支払い方法登録状態とその根拠を組み合わせた評価結果。 */
export type OrganizationBillingPaymentMethodEvaluation = {
  status: OrganizationBillingPaymentMethodStatus;
  reason: OrganizationBillingPaymentMethodReason;
};

/** Owner が現在実行できる billing action と実行できない理由。 */
export type OrganizationBillingActionAvailability = {
  canStartTrial: boolean;
  canStartPaidCheckout: boolean;
  canRegisterPaymentMethod: boolean;
  canOpenBillingPortal: boolean;
  trialUsed: boolean;
  availableIntervals: Array<'month' | 'year'>;
  nextOwnerAction: string | null;
  readOnlyReason: string | null;
};

/** Billing policy が plan state と payment method を解決するために読む最小 summary。 */
export type OrganizationBillingSummaryLike = {
  planCode: OrganizationBillingPlanCode;
  billingInterval: 'month' | 'year' | null;
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  billingProfileReadiness?: string | null;
  billingProfileNextAction?: string | null;
  billingProfileCheckedAt?: Date | string | number | null;
} | null;

type OrganizationBillingPaymentIssueEventType =
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

/**
 * 支払い失敗の起点時刻と猶予期限を、provider 時刻とアプリ受領時刻のどちら由来か判別できる形で返す。
 */
export const resolveOrganizationBillingPaymentIssueTiming = ({
  paymentIssueStartedAt,
  pastDueGraceEndsAt,
  providerIssueStartedAt,
}: {
  paymentIssueStartedAt?: Date | string | null;
  pastDueGraceEndsAt?: Date | string | null;
  providerIssueStartedAt?: Date | string | null;
}): OrganizationBillingPaymentIssueTiming => {
  const issueStartedAt = toIsoDateString(paymentIssueStartedAt);
  const graceEndsAt = toIsoDateString(pastDueGraceEndsAt);
  const issueTime = toTime(issueStartedAt);
  const providerTime = toTime(providerIssueStartedAt ?? null);
  const issueStartedAtSource: OrganizationBillingPaymentIssueStartedAtSource = !issueStartedAt
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
 * subscription status と直近の invoice/payment event から、owner 向けに表示する支払い問題状態を決める。
 *
 * Stripe 側で復旧済みでも失敗 event が後着することがあるため、stale failure history を
 * 通常の未払い状態とは分けて返す。
 */
export const resolveOrganizationBillingPaymentIssueState = ({
  subscriptionStatus,
  entitlementReason,
  latestPaymentIssueEventType = null,
  hasRecoveredPaymentIssueHistory = false,
  hasStaleFailureHistory = false,
}: {
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
  entitlementReason?: string | null;
  latestPaymentIssueEventType?: OrganizationBillingPaymentIssueEventType;
  hasRecoveredPaymentIssueHistory?: boolean;
  hasStaleFailureHistory?: boolean;
}): OrganizationBillingPaymentIssueState => {
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
export const isBillingInterval = (value: string | null): 'month' | 'year' | null => {
  if (value === 'month' || value === 'year') {
    return value;
  }
  return null;
};

/** 不明な文字列を除外し、billing subscription status として扱える値だけを返す。 */
export const isBillingSubscriptionStatus = (
  value: string | null,
): OrganizationBillingSubscriptionStatus | null => {
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
export const hasActivePremiumSubscription = (value: string | null): boolean => {
  return (
    value === 'trialing' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'unpaid' ||
    value === 'incomplete'
  );
};

/** Billing summary row に保存された profile readiness を owner 表示用の型へ正規化する。 */
export const resolveOrganizationBillingProfileReadiness = (
  billing: OrganizationBillingSummaryLike,
): OrganizationBillingProfileReadiness =>
  buildBillingProfileReadiness({
    state: billing?.billingProfileReadiness ?? 'not_required',
    nextAction: billing?.billingProfileNextAction ?? null,
    checkedAt: billing?.billingProfileCheckedAt ?? null,
  });

/**
 * 現在の billing state、owner 権限、Stripe 設定から owner が次に実行できる billing 操作を返す。
 */
export const resolveOrganizationBillingActionAvailability = ({
  billing,
  canManageBilling,
  trialUsed,
  stripeBillingConfigured,
  availableIntervals,
}: {
  billing: OrganizationBillingSummaryLike;
  canManageBilling: boolean;
  trialUsed: boolean;
  stripeBillingConfigured: boolean;
  availableIntervals: Array<'month' | 'year'>;
}): OrganizationBillingActionAvailability => {
  const planCode: OrganizationBillingPlanCode =
    billing?.planCode === 'premium' ? 'premium' : 'free';
  const subscriptionStatus =
    isBillingSubscriptionStatus(billing?.subscriptionStatus ?? null) ?? 'free';
  const providerLinked = Boolean(billing?.stripeCustomerId && billing?.stripeSubscriptionId);
  const hasProviderManagedSubscription =
    planCode === 'premium' &&
    providerLinked &&
    (subscriptionStatus === 'active' ||
      subscriptionStatus === 'trialing' ||
      subscriptionStatus === 'past_due' ||
      subscriptionStatus === 'unpaid' ||
      subscriptionStatus === 'incomplete');
  const canStartTrial =
    canManageBilling &&
    stripeBillingConfigured &&
    availableIntervals.length > 0 &&
    !trialUsed &&
    planCode === 'free' &&
    subscriptionStatus === 'free';
  const canStartPaidCheckout =
    canManageBilling &&
    stripeBillingConfigured &&
    availableIntervals.length > 0 &&
    (planCode === 'free' || subscriptionStatus === 'free' || subscriptionStatus === 'canceled') &&
    !hasProviderManagedSubscription;
  const canRegisterPaymentMethod =
    canManageBilling &&
    stripeBillingConfigured &&
    planCode === 'premium' &&
    subscriptionStatus === 'trialing';
  const canOpenBillingPortal =
    canManageBilling && stripeBillingConfigured && hasProviderManagedSubscription;
  const readOnlyReason = !canManageBilling
    ? 'billing_management_requires_organization_owner'
    : planCode === 'free' && !stripeBillingConfigured
      ? 'stripe_billing_not_configured'
      : planCode === 'free' && availableIntervals.length === 0
        ? 'billing_price_not_configured'
        : null;
  const nextOwnerAction =
    readOnlyReason ??
    (canStartTrial
      ? 'start_trial'
      : canStartPaidCheckout
        ? 'start_paid_checkout'
        : canRegisterPaymentMethod
          ? 'register_payment_method'
          : canOpenBillingPortal
            ? 'open_billing_portal'
            : null);

  return {
    canStartTrial,
    canStartPaidCheckout,
    canRegisterPaymentMethod,
    canOpenBillingPortal,
    trialUsed,
    availableIntervals,
    nextOwnerAction,
    readOnlyReason,
  };
};

/** Plan code と subscription status から owner UI の plan lifecycle state を解決する。 */
export const resolveOrganizationBillingPlanState = ({
  planCode,
  subscriptionStatus,
}: {
  planCode: OrganizationBillingPlanCode;
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
}): OrganizationBillingPlanState => {
  if (planCode !== 'premium') {
    return 'free';
  }

  return subscriptionStatus === 'trialing' ? 'premium_trial' : 'premium_paid';
};

/** Trial 中の場合だけ current period end を trial end として返す。 */
export const resolveOrganizationBillingTrialEndsAt = ({
  planState,
  currentPeriodEnd,
}: {
  planState: OrganizationBillingPlanState;
  currentPeriodEnd: string | null;
}): string | null => {
  return planState === 'premium_trial' ? currentPeriodEnd : null;
};

/**
 * Stripe customer の default payment method を読み、trial 終了や CTA 表示に使う支払い方法状態を評価する。
 *
 * Stripe 未設定・一時的な lookup 失敗は、即時失格ではなく pending として扱う。
 */
export const resolveOrganizationBillingPaymentMethodEvaluation = async ({
  env,
  planCode,
  stripeCustomerId,
}: {
  env: AuthRuntimeEnv;
  planCode: OrganizationBillingPlanCode;
  stripeCustomerId: string | null;
}): Promise<OrganizationBillingPaymentMethodEvaluation> => {
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
export const resolveOrganizationBillingPaymentMethodStatus = async ({
  env,
  planCode,
  stripeCustomerId,
}: {
  env: AuthRuntimeEnv;
  planCode: OrganizationBillingPlanCode;
  stripeCustomerId: string | null;
}): Promise<OrganizationBillingPaymentMethodStatus> => {
  const paymentMethod = await resolveOrganizationBillingPaymentMethodEvaluation({
    env,
    planCode,
    stripeCustomerId,
  });

  return paymentMethod.status;
};

/** 環境変数に設定された Stripe price id から billing interval を逆引きする。 */
export const resolveBillingIntervalFromPriceId = (
  env: AuthRuntimeEnv,
  priceId: string | null,
): 'month' | 'year' | null => {
  if (!priceId) {
    return null;
  }
  if (env.STRIPE_PREMIUM_MONTHLY_PRICE_ID?.trim() === priceId) {
    return 'month';
  }
  if (env.STRIPE_PREMIUM_YEARLY_PRICE_ID?.trim() === priceId) {
    return 'year';
  }
  return null;
};
