import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import {
  resolveReserveAppBillingPaymentMethodStatus,
  resolveReserveAppBillingPlanState,
  resolveReserveAppBillingTrialEndsAt,
  type ReserveAppBillingPaymentMethodStatus,
  type ReserveAppBillingPlanCode,
  type ReserveAppBillingPlanState,
  type ReserveAppBillingSubscriptionStatus,
} from '../../features/billing/policies/reserve-app-billing-policy.js';
import { readReserveAppBillingV2Summary } from '../../infra/billing/reserve-app-billing-v2-source.js';

export type ReserveAppBillingEntitlementState = 'free_only' | 'premium_enabled';
export type ReserveAppBillingPaidTierCode =
  | 'premium_default'
  | 'premium_growth'
  | 'premium_scale'
  | 'premium_unknown';
export type ReserveAppBillingPaidTierCapability =
  | 'organization_premium_features'
  | 'advanced_billing_communications';
export type ReserveAppBillingPaidTierResolution =
  | 'not_paid'
  | 'legacy_default'
  | 'known_price'
  | 'unknown_price';

export type ReserveAppBillingPaidTierCatalogEntry = {
  code: Exclude<ReserveAppBillingPaidTierCode, 'premium_unknown'>;
  label: string;
  capabilities: ReserveAppBillingPaidTierCapability[];
  priceIds: string[];
};

export type ReserveAppBillingPaidTier = {
  code: ReserveAppBillingPaidTierCode;
  label: string;
  resolution: ReserveAppBillingPaidTierResolution;
  capabilities: ReserveAppBillingPaidTierCapability[];
  diagnosticReason: string | null;
};

export type ReserveAppPremiumEntitlementReason =
  | 'organization_plan_is_free'
  | 'premium_trial_active'
  | 'premium_trial_active_with_payment_method_registered'
  | 'premium_trial_missing_end'
  | 'premium_trial_expired'
  | 'premium_paid_unknown_price'
  | 'premium_paid_active'
  | 'premium_paid_scheduled_cancellation_active'
  | 'premium_paid_past_due_grace_active'
  | 'premium_paid_past_due_grace_missing'
  | 'premium_paid_past_due_grace_expired'
  | 'premium_paid_unpaid'
  | 'premium_paid_incomplete'
  | 'premium_paid_canceled'
  | 'premium_paid_state_unexpected';

export type ReserveAppPremiumEntitlementPolicyInput = {
  planCode: ReserveAppBillingPlanCode;
  subscriptionStatus: ReserveAppBillingSubscriptionStatus;
  paymentMethodStatus: ReserveAppBillingPaymentMethodStatus;
  currentPeriodEnd: string | null;
  pastDueGraceEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  stripePriceId?: string | null;
  env?: Partial<
    Pick<AuthRuntimeEnv, 'STRIPE_PREMIUM_MONTHLY_PRICE_ID' | 'STRIPE_PREMIUM_YEARLY_PRICE_ID'>
  >;
  additionalTierCatalogEntries?: ReserveAppBillingPaidTierCatalogEntry[];
  now?: Date;
};

export type ReserveAppPremiumEntitlementPolicyResult = {
  scope: 'organization';
  source: 'application_billing_state';
  planState: ReserveAppBillingPlanState;
  paymentMethodStatus: ReserveAppBillingPaymentMethodStatus;
  trialEndsAt: string | null;
  entitlementState: ReserveAppBillingEntitlementState;
  isPremiumEligible: boolean;
  paidTier: ReserveAppBillingPaidTier | null;
  reason: ReserveAppPremiumEntitlementReason;
};

const defaultPaidTierCapabilities = [
  'organization_premium_features',
] satisfies ReserveAppBillingPaidTierCapability[];

export const RESERVE_APP_BILLING_DEFAULT_PAID_TIER: ReserveAppBillingPaidTierCatalogEntry = {
  code: 'premium_default',
  label: 'Premium',
  capabilities: [...defaultPaidTierCapabilities],
  priceIds: [],
};

const normalizePriceIds = (priceIds: Array<string | undefined>): string[] =>
  priceIds
    .map((priceId) => priceId?.trim() ?? '')
    .filter((priceId): priceId is string => priceId.length > 0);

/**
 * Stripe price id をアプリ内の有料 tier に解決する。
 *
 * 未知の price は premium_unknown として扱い、意図しない entitlement 付与を避ける。
 */
export const resolveReserveAppBillingPaidTier = ({
  planCode,
  stripePriceId,
  env,
  additionalCatalogEntries = [],
}: {
  planCode: ReserveAppBillingPlanCode;
  stripePriceId?: string | null;
  env?: Partial<
    Pick<AuthRuntimeEnv, 'STRIPE_PREMIUM_MONTHLY_PRICE_ID' | 'STRIPE_PREMIUM_YEARLY_PRICE_ID'>
  >;
  additionalCatalogEntries?: ReserveAppBillingPaidTierCatalogEntry[];
}): ReserveAppBillingPaidTier | null => {
  if (planCode !== 'premium') {
    return null;
  }

  const defaultEntry = {
    ...RESERVE_APP_BILLING_DEFAULT_PAID_TIER,
    priceIds: normalizePriceIds([
      env?.STRIPE_PREMIUM_MONTHLY_PRICE_ID,
      env?.STRIPE_PREMIUM_YEARLY_PRICE_ID,
    ]),
  };
  const catalog = [defaultEntry, ...additionalCatalogEntries];
  const normalizedPriceId = stripePriceId?.trim() ?? '';

  if (!normalizedPriceId) {
    return {
      code: defaultEntry.code,
      label: defaultEntry.label,
      resolution: 'legacy_default',
      capabilities: [...defaultEntry.capabilities],
      diagnosticReason: null,
    };
  }

  const matchedEntry = catalog.find((entry) =>
    entry.priceIds.some((priceId) => priceId === normalizedPriceId),
  );
  if (matchedEntry) {
    return {
      code: matchedEntry.code,
      label: matchedEntry.label,
      resolution: 'known_price',
      capabilities: [...matchedEntry.capabilities],
      diagnosticReason: null,
    };
  }

  return {
    code: 'premium_unknown',
    label: defaultEntry.label,
    resolution: 'unknown_price',
    capabilities: [],
    diagnosticReason: 'stripe_price_id_not_in_paid_tier_catalog',
  };
};

/** paid tier が指定 capability を持つかを、null-safe に判定する。 */
export const hasReserveAppBillingPaidTierCapability = (
  paidTier: ReserveAppBillingPaidTier | null,
  capability: ReserveAppBillingPaidTierCapability,
): boolean => paidTier?.capabilities.includes(capability) ?? false;

const isFutureIsoDate = (value: string | null | undefined, now: Date) => {
  if (!value) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime();
};

/**
 * reserve-app billing aggregate から Premium 利用可否を決める唯一の policy 関数。
 *
 * trial、paid、past_due grace、unknown price を route 側で個別判断しないために、
 * UI 表示用の reason もここで揃える。
 */
export const resolveReserveAppPremiumEntitlementPolicy = ({
  planCode,
  subscriptionStatus,
  paymentMethodStatus,
  currentPeriodEnd,
  pastDueGraceEndsAt,
  cancelAtPeriodEnd = false,
  stripePriceId,
  env,
  additionalTierCatalogEntries,
  now = new Date(),
}: ReserveAppPremiumEntitlementPolicyInput): ReserveAppPremiumEntitlementPolicyResult => {
  const planState = resolveReserveAppBillingPlanState({
    planCode,
    subscriptionStatus,
  });
  const trialEndsAt = resolveReserveAppBillingTrialEndsAt({
    planState,
    currentPeriodEnd,
  });
  const paidTier = resolveReserveAppBillingPaidTier({
    planCode,
    stripePriceId,
    env,
    additionalCatalogEntries: additionalTierCatalogEntries,
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
      paidTier: null,
      reason: 'organization_plan_is_free',
    };
  }

  if (paidTier?.resolution === 'unknown_price') {
    return {
      scope: 'organization',
      source: 'application_billing_state',
      planState,
      paymentMethodStatus,
      trialEndsAt,
      entitlementState: 'free_only',
      isPremiumEligible: false,
      paidTier,
      reason: 'premium_paid_unknown_price',
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
        paidTier,
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
        paidTier,
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
      paidTier,
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
      paidTier,
      reason: cancelAtPeriodEnd
        ? 'premium_paid_scheduled_cancellation_active'
        : 'premium_paid_active',
    };
  }

  if (subscriptionStatus === 'past_due') {
    if (!pastDueGraceEndsAt) {
      return {
        scope: 'organization',
        source: 'application_billing_state',
        planState,
        paymentMethodStatus,
        trialEndsAt,
        entitlementState: 'free_only',
        isPremiumEligible: false,
        paidTier,
        reason: 'premium_paid_past_due_grace_missing',
      };
    }

    if (!isFutureIsoDate(pastDueGraceEndsAt, now)) {
      return {
        scope: 'organization',
        source: 'application_billing_state',
        planState,
        paymentMethodStatus,
        trialEndsAt,
        entitlementState: 'free_only',
        isPremiumEligible: false,
        paidTier,
        reason: 'premium_paid_past_due_grace_expired',
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
      paidTier,
      reason: 'premium_paid_past_due_grace_active',
    };
  }

  if (subscriptionStatus === 'unpaid') {
    return {
      scope: 'organization',
      source: 'application_billing_state',
      planState,
      paymentMethodStatus,
      trialEndsAt,
      entitlementState: 'free_only',
      isPremiumEligible: false,
      paidTier,
      reason: 'premium_paid_unpaid',
    };
  }

  if (subscriptionStatus === 'incomplete') {
    return {
      scope: 'organization',
      source: 'application_billing_state',
      planState,
      paymentMethodStatus,
      trialEndsAt,
      entitlementState: 'free_only',
      isPremiumEligible: false,
      paidTier,
      reason: 'premium_paid_incomplete',
    };
  }

  if (subscriptionStatus === 'canceled') {
    return {
      scope: 'organization',
      source: 'application_billing_state',
      planState,
      paymentMethodStatus,
      trialEndsAt,
      entitlementState: 'free_only',
      isPremiumEligible: false,
      paidTier,
      reason: 'premium_paid_canceled',
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
    paidTier,
    reason: 'premium_paid_state_unexpected',
  };
};

/** D1 の billing aggregate と Stripe payment method 状態を読み、現在の Premium policy を返す。 */
export const readReserveAppPremiumEntitlementPolicy = async ({
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
  const billing = await readReserveAppBillingV2Summary({ database, env, organizationId });
  const planCode: ReserveAppBillingPlanCode =
    billing?.planCode === 'premium' ? 'premium' : 'free';
  const subscriptionStatus: ReserveAppBillingSubscriptionStatus =
    billing?.subscriptionStatus === 'trialing' ||
    billing?.subscriptionStatus === 'active' ||
    billing?.subscriptionStatus === 'past_due' ||
    billing?.subscriptionStatus === 'canceled' ||
    billing?.subscriptionStatus === 'unpaid' ||
    billing?.subscriptionStatus === 'incomplete'
      ? billing.subscriptionStatus
      : 'free';
  const paymentMethodStatus = await resolveReserveAppBillingPaymentMethodStatus({
    env,
    planCode,
    stripeCustomerId: billing?.stripeCustomerId ?? null,
  });

  return resolveReserveAppPremiumEntitlementPolicy({
    planCode,
    subscriptionStatus,
    paymentMethodStatus,
    currentPeriodEnd:
      billing?.currentPeriodEnd instanceof Date ? billing.currentPeriodEnd.toISOString() : null,
    pastDueGraceEndsAt:
      billing?.pastDueGraceEndsAt instanceof Date ? billing.pastDueGraceEndsAt.toISOString() : null,
    cancelAtPeriodEnd: Boolean(billing?.cancelAtPeriodEnd),
    stripePriceId: billing?.stripePriceId ?? null,
    env,
    now,
  });
};
