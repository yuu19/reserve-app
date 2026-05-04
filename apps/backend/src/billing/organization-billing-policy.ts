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
export type OrganizationBillingPaidTierCode =
  | 'premium_default'
  | 'premium_growth'
  | 'premium_scale'
  | 'premium_unknown';
export type OrganizationBillingPaidTierCapability =
  | 'organization_premium_features'
  | 'advanced_billing_communications';
export type OrganizationBillingPaidTierResolution =
  | 'not_paid'
  | 'legacy_default'
  | 'known_price'
  | 'unknown_price';

export type OrganizationBillingPaidTierCatalogEntry = {
  code: Exclude<OrganizationBillingPaidTierCode, 'premium_unknown'>;
  label: string;
  capabilities: OrganizationBillingPaidTierCapability[];
  priceIds: string[];
};

export type OrganizationBillingPaidTier = {
  code: OrganizationBillingPaidTierCode;
  label: string;
  resolution: OrganizationBillingPaidTierResolution;
  capabilities: OrganizationBillingPaidTierCapability[];
  diagnosticReason: string | null;
};

export type OrganizationPremiumEntitlementReason =
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

export type OrganizationPremiumEntitlementPolicyInput = {
  planCode: OrganizationBillingPlanCode;
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
  paymentMethodStatus: OrganizationBillingPaymentMethodStatus;
  currentPeriodEnd: string | null;
  pastDueGraceEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  stripePriceId?: string | null;
  env?: Partial<
    Pick<AuthRuntimeEnv, 'STRIPE_PREMIUM_MONTHLY_PRICE_ID' | 'STRIPE_PREMIUM_YEARLY_PRICE_ID'>
  >;
  additionalTierCatalogEntries?: OrganizationBillingPaidTierCatalogEntry[];
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
  paidTier: OrganizationBillingPaidTier | null;
  reason: OrganizationPremiumEntitlementReason;
};

const defaultPaidTierCapabilities = [
  'organization_premium_features',
] satisfies OrganizationBillingPaidTierCapability[];

export const ORGANIZATION_BILLING_DEFAULT_PAID_TIER: OrganizationBillingPaidTierCatalogEntry = {
  code: 'premium_default',
  label: 'Premium',
  capabilities: [...defaultPaidTierCapabilities],
  priceIds: [],
};

const normalizePriceIds = (priceIds: Array<string | undefined>): string[] =>
  priceIds
    .map((priceId) => priceId?.trim() ?? '')
    .filter((priceId): priceId is string => priceId.length > 0);

export const resolveOrganizationBillingPaidTier = ({
  planCode,
  stripePriceId,
  env,
  additionalCatalogEntries = [],
}: {
  planCode: OrganizationBillingPlanCode;
  stripePriceId?: string | null;
  env?: Partial<
    Pick<AuthRuntimeEnv, 'STRIPE_PREMIUM_MONTHLY_PRICE_ID' | 'STRIPE_PREMIUM_YEARLY_PRICE_ID'>
  >;
  additionalCatalogEntries?: OrganizationBillingPaidTierCatalogEntry[];
}): OrganizationBillingPaidTier | null => {
  if (planCode !== 'premium') {
    return null;
  }

  const defaultEntry = {
    ...ORGANIZATION_BILLING_DEFAULT_PAID_TIER,
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

export const hasOrganizationBillingPaidTierCapability = (
  paidTier: OrganizationBillingPaidTier | null,
  capability: OrganizationBillingPaidTierCapability,
): boolean => paidTier?.capabilities.includes(capability) ?? false;

const isFutureIsoDate = (value: string | null | undefined, now: Date) => {
  if (!value) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime();
};

export const resolveOrganizationPremiumEntitlementPolicy = ({
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
}: OrganizationPremiumEntitlementPolicyInput): OrganizationPremiumEntitlementPolicyResult => {
  const planState = resolveOrganizationBillingPlanState({
    planCode,
    subscriptionStatus,
  });
  const trialEndsAt = resolveOrganizationBillingTrialEndsAt({
    planState,
    currentPeriodEnd,
  });
  const paidTier = resolveOrganizationBillingPaidTier({
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
  const planCode: OrganizationBillingPlanCode =
    billing?.planCode === 'premium' ? 'premium' : 'free';
  const subscriptionStatus: OrganizationBillingSubscriptionStatus =
    billing?.subscriptionStatus === 'trialing' ||
    billing?.subscriptionStatus === 'active' ||
    billing?.subscriptionStatus === 'past_due' ||
    billing?.subscriptionStatus === 'canceled' ||
    billing?.subscriptionStatus === 'unpaid' ||
    billing?.subscriptionStatus === 'incomplete'
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
    pastDueGraceEndsAt:
      billing?.pastDueGraceEndsAt instanceof Date ? billing.pastDueGraceEndsAt.toISOString() : null,
    cancelAtPeriodEnd: Boolean(billing?.cancelAtPeriodEnd),
    stripePriceId: billing?.stripePriceId ?? null,
    env,
    now,
  });
};
