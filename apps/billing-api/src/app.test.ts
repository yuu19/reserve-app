import { describe, expect, test } from 'vitest';
import {
  buildBillingApiFeatures,
  createBillingApiApp,
  readStripeSubscriptionSnapshot,
} from './app.js';

describe('createBillingApiApp', () => {
  test('returns health status', async () => {
    const response = await createBillingApiApp().request('/api/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test('builds feature map from currently effective entitlements', () => {
    const timestamp = new Date('2026-06-23T00:00:00.000Z');
    const baseRow = {
      id: 'entitlement_1',
      appId: 'reserve',
      subjectRowId: 'subject_1',
      billingAccountId: 'account_1',
      active: true,
      source: 'paid',
      reason: 'stripe_subscription_active',
      validFrom: null,
      generatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const features = buildBillingApiFeatures({
      timestamp,
      entitlements: [
        {
          ...baseRow,
          key: 'staffLimit',
          valueType: 'number',
          valueJson: '10',
          validUntil: new Date('2026-07-23T00:00:00.000Z'),
        },
        {
          ...baseRow,
          id: 'entitlement_2',
          key: 'onlinePayment',
          valueType: 'boolean',
          valueJson: 'true',
          validUntil: null,
        },
        {
          ...baseRow,
          id: 'entitlement_3',
          key: 'expiredFeature',
          valueType: 'boolean',
          valueJson: 'true',
          validUntil: new Date('2026-06-22T00:00:00.000Z'),
        },
      ] as never,
    });

    expect(features).toEqual({
      staffLimit: 10,
      onlinePayment: true,
    });
  });

  test('normalizes Stripe subscription payload for billing sync', () => {
    const snapshot = readStripeSubscriptionSnapshot({
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
      current_period_start: 1_780_000_000,
      current_period_end: 1_782_592_000,
      cancel_at_period_end: false,
      metadata: {
        appId: 'reserve',
        subjectType: 'organization',
        subjectId: 'org_123',
        planCode: 'premium',
      },
      items: {
        data: [
          {
            price: {
              id: 'price_monthly',
              recurring: {
                interval: 'month',
              },
            },
          },
        ],
      },
    });

    expect(snapshot).toMatchObject({
      id: 'sub_123',
      customerId: 'cus_123',
      status: 'active',
      providerPriceId: 'price_monthly',
      interval: 'month',
      metadata: {
        appId: 'reserve',
        subjectType: 'organization',
        subjectId: 'org_123',
        planCode: 'premium',
      },
    });
    expect(snapshot?.currentPeriodStart?.toISOString()).toBe('2026-05-28T20:26:40.000Z');
    expect(snapshot?.currentPeriodEnd?.toISOString()).toBe('2026-06-27T20:26:40.000Z');
  });
});
