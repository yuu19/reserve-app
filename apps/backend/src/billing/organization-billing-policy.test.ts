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

  it('keeps past_due eligible during the seven-day grace window', () => {
    const result = resolveOrganizationPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'past_due',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: null,
      pastDueGraceEndsAt: '2026-04-10T12:00:00.000Z',
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_paid',
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_paid_past_due_grace_active',
    });
  });

  it('stops premium after past_due grace expires', () => {
    const result = resolveOrganizationPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'past_due',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: null,
      pastDueGraceEndsAt: '2026-04-09T11:59:59.000Z',
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_paid',
      entitlementState: 'free_only',
      isPremiumEligible: false,
      reason: 'premium_paid_past_due_grace_expired',
    });
  });

  it('stops premium immediately for unpaid, incomplete, and canceled paid states', () => {
    for (const [subscriptionStatus, reason] of [
      ['unpaid', 'premium_paid_unpaid'],
      ['incomplete', 'premium_paid_incomplete'],
      ['canceled', 'premium_paid_canceled'],
    ] as const) {
      const result = resolveOrganizationPremiumEntitlementPolicy({
        planCode: 'premium',
        subscriptionStatus,
        paymentMethodStatus: 'registered',
        currentPeriodEnd: null,
        now,
      });

      expect(result).toMatchObject({
        planState: 'premium_paid',
        entitlementState: 'free_only',
        isPremiumEligible: false,
        reason,
      });
    }
  });

  it('keeps scheduled period-end cancellation eligible until provider state changes', () => {
    const result = resolveOrganizationPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'active',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: '2026-05-01T00:00:00.000Z',
      cancelAtPeriodEnd: true,
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_paid',
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_paid_scheduled_cancellation_active',
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

  it('exposes unknown paid provider prices without granting capabilities', () => {
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
      capabilities: [],
    });
    expect(result.capabilities).not.toContain('advanced_billing_communications');
  });

  it('stops premium eligibility for unknown paid provider prices', () => {
    const result = resolveOrganizationPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'active',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: null,
      stripePriceId: 'price_unmapped_provider_value',
      env: {
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: 'price_current_monthly',
      },
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_paid',
      entitlementState: 'free_only',
      isPremiumEligible: false,
      reason: 'premium_paid_unknown_price',
      paidTier: {
        code: 'premium_unknown',
        resolution: 'unknown_price',
      },
    });
  });
});
