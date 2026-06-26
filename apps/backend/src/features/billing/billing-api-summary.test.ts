import { describe, expect, it } from 'vitest';
import type { BillingApiSummaryResponse } from '@repo/billing-types';
import {
  hasBillingApiPremiumEntitlement,
  readBillingApiFeatureEntitlement,
} from './billing-api-summary.js';

const baseSummary = {
  subject: {
    appId: 'reserve',
    subjectType: 'organization',
    subjectId: 'org_1',
    status: 'active',
    displayName: 'Org',
    billingEmail: null,
    billingName: 'Org',
    billingContacts: [],
    metadata: {},
    createdAt: '2026-06-26T00:00:00.000Z',
    updatedAt: '2026-06-26T00:00:00.000Z',
  },
  account: {
    id: 'billing_account_1',
    provider: 'stripe',
    providerCustomerId: 'cus_1',
    createdAt: '2026-06-26T00:00:00.000Z',
    updatedAt: '2026-06-26T00:00:00.000Z',
  },
  subscription: {
    id: 'billing_subscription_1',
    provider: 'stripe',
    providerSubscriptionId: 'sub_1',
    planCode: 'premium',
    priceCode: 'premium_monthly',
    providerPriceId: 'price_1',
    priceResolution: 'known',
    interval: 'month',
    status: 'active',
    currentPeriodStart: '2026-06-26T00:00:00.000Z',
    currentPeriodEnd: '2026-07-26T00:00:00.000Z',
    trialStart: null,
    trialEnd: null,
    cancelAtPeriodEnd: false,
    createdAt: '2026-06-26T00:00:00.000Z',
    updatedAt: '2026-06-26T00:00:00.000Z',
  },
  entitlements: {
    appId: 'reserve',
    subjectType: 'organization',
    subjectId: 'org_1',
    planCode: 'premium',
    status: 'active',
    priceResolution: 'known',
    features: {},
    entitlements: [],
    syncedAt: '2026-06-26T00:00:00.000Z',
    evaluatedAt: '2026-06-26T00:00:00.000Z',
    timeSource: 'server',
    maxStaleSeconds: 300,
  },
  provider: {
    stripeConfigured: true,
    stripeWebhookConfigured: true,
  },
} satisfies BillingApiSummaryResponse;

const buildSummary = (
  overrides: Partial<BillingApiSummaryResponse> = {},
): BillingApiSummaryResponse => ({
  ...baseSummary,
  ...overrides,
  subscription:
    overrides.subscription === undefined ? baseSummary.subscription : overrides.subscription,
  entitlements: {
    ...baseSummary.entitlements,
    ...overrides.entitlements,
  },
});

describe('Billing API summary entitlement helpers', () => {
  it('organization.premium feature が true なら Premium と判定する', () => {
    const summary = buildSummary({
      entitlements: {
        ...baseSummary.entitlements,
        features: { 'organization.premium': true },
      },
    });

    expect(hasBillingApiPremiumEntitlement(summary)).toBe(true);
    expect(readBillingApiFeatureEntitlement({ summary, key: 'organization.premium' })).toBe(true);
  });

  it('organization.premium feature が未生成でも premium active/trialing なら Premium と判定する', () => {
    const summary = buildSummary({
      entitlements: {
        ...baseSummary.entitlements,
        features: {},
      },
    });

    expect(hasBillingApiPremiumEntitlement(summary)).toBe(true);
  });

  it('organization.premium feature の明示 false は plan/status fallback より優先する', () => {
    const summary = buildSummary({
      entitlements: {
        ...baseSummary.entitlements,
        features: { 'organization.premium': false },
      },
    });

    expect(hasBillingApiPremiumEntitlement(summary)).toBe(false);
  });

  it('free status は organization.premium なしの場合 Premium と判定しない', () => {
    const summary = buildSummary({
      subscription: null,
      entitlements: {
        ...baseSummary.entitlements,
        planCode: 'free',
        status: 'free',
        priceResolution: 'not_applicable',
        features: {},
      },
    });

    expect(hasBillingApiPremiumEntitlement(summary)).toBe(false);
  });

  it('generic feature は boolean が明示されている場合だけ entitlement として扱う', () => {
    const summary = buildSummary({
      entitlements: {
        ...baseSummary.entitlements,
        features: { onlinePayment: true, staffLimit: 10 },
      },
    });

    expect(readBillingApiFeatureEntitlement({ summary, key: 'onlinePayment' })).toBe(true);
    expect(readBillingApiFeatureEntitlement({ summary, key: 'staffLimit' })).toBe(null);
    expect(readBillingApiFeatureEntitlement({ summary, key: 'missingFeature' })).toBe(null);
  });
});
