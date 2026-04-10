import { describe, expect, it } from 'vitest';
import { resolveOrganizationPremiumEntitlementPolicy } from './organization-billing-policy.js';

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
});
