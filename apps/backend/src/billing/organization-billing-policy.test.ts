import { describe, expect, it } from 'vitest';
import {
  resolveOrganizationBillingPaidTier,
  resolveOrganizationPremiumEntitlementPolicy,
} from './organization-billing-policy.js';

describe('organization billing premium entitlement policy', () => {
  const now = new Date('2026-04-09T12:00:00.000Z');

  it('returns a free-only entitlement for free organizations', () => {
    const result = resolveOrganizationPremiumEntitlementPolicy({
      planCode: 'free',
      subscriptionStatus: 'free',
      paymentMethodStatus: 'not_started',
      currentPeriodEnd: null,
      now,
    });

    expect(result).toMatchObject({
      scope: 'organization',
      source: 'application_billing_state',
      planState: 'free',
      trialEndsAt: null,
      entitlementState: 'free_only',
      isPremiumEligible: false,
      reason: 'organization_plan_is_free',
    });
  });

  it('keeps active premium trials eligible for the whole organization', () => {
    const result = resolveOrganizationPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      paymentMethodStatus: 'pending',
      currentPeriodEnd: '2026-04-12T12:00:00.000Z',
      now,
    });

    expect(result).toMatchObject({
      scope: 'organization',
      source: 'application_billing_state',
      planState: 'premium_trial',
      trialEndsAt: '2026-04-12T12:00:00.000Z',
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_trial_active',
    });
  });

  it('exposes a distinct reason when the active trial already has a payment method', () => {
    const result = resolveOrganizationPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: '2026-04-12T12:00:00.000Z',
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_trial',
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_trial_active_with_payment_method_registered',
    });
  });

  it('removes premium eligibility once the trial end has passed even if billing state is still trialing', () => {
    const result = resolveOrganizationPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      paymentMethodStatus: 'pending',
      currentPeriodEnd: '2026-04-09T11:59:59.000Z',
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_trial',
      trialEndsAt: '2026-04-09T11:59:59.000Z',
      entitlementState: 'free_only',
      isPremiumEligible: false,
      reason: 'premium_trial_expired',
    });
  });

  it('treats missing trial end information as ineligible instead of assuming premium access', () => {
    const result = resolveOrganizationPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      paymentMethodStatus: 'pending',
      currentPeriodEnd: null,
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_trial',
      entitlementState: 'free_only',
      isPremiumEligible: false,
      reason: 'premium_trial_missing_end',
    });
  });

  it('keeps active paid subscriptions eligible', () => {
    const result = resolveOrganizationPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'active',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: null,
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_paid',
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_paid_active',
      paidTier: {
        code: 'premium_default',
        label: 'Premium',
        resolution: 'legacy_default',
        capabilities: ['organization_premium_features'],
      },
    });
  });

  it('keeps paid grace states eligible without relying on raw provider shortcuts in consumers', () => {
    const result = resolveOrganizationPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'past_due',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: null,
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_paid',
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_paid_grace_state',
    });
  });

  it('maps existing premium price ids to the default paid tier without leaking provider ids to consumers', () => {
    const result = resolveOrganizationBillingPaidTier({
      planCode: 'premium',
      stripePriceId: 'price_current_monthly',
      env: {
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: 'price_current_monthly',
        STRIPE_PREMIUM_YEARLY_PRICE_ID: 'price_current_yearly',
      },
    });

    expect(result).toMatchObject({
      code: 'premium_default',
      label: 'Premium',
      resolution: 'known_price',
      capabilities: ['organization_premium_features'],
    });
  });

  it('supports future tier capability bundles through explicit catalog entries', () => {
    const result = resolveOrganizationBillingPaidTier({
      planCode: 'premium',
      stripePriceId: 'price_growth_monthly',
      env: {
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: 'price_current_monthly',
      },
      additionalCatalogEntries: [
        {
          code: 'premium_growth',
          label: 'Premium Growth',
          capabilities: ['organization_premium_features', 'advanced_billing_communications'],
          priceIds: ['price_growth_monthly'],
        },
      ],
    });

    expect(result).toMatchObject({
      code: 'premium_growth',
      label: 'Premium Growth',
      resolution: 'known_price',
      capabilities: ['organization_premium_features', 'advanced_billing_communications'],
    });
  });

  it('keeps unknown paid provider prices on the legacy capability floor instead of escalating tiers', () => {
    const result = resolveOrganizationBillingPaidTier({
      planCode: 'premium',
      stripePriceId: 'price_unmapped_provider_value',
      env: {
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: 'price_current_monthly',
      },
    });

    expect(result).toMatchObject({
      code: 'premium_unknown',
      label: 'Premium',
      resolution: 'unknown_price',
      diagnosticReason: 'stripe_price_id_not_in_paid_tier_catalog',
      capabilities: ['organization_premium_features'],
    });
    expect(result.capabilities).not.toContain('advanced_billing_communications');
  });
});
