import { describe, expect, test } from 'vitest';
import {
  appendStripeSubscriptionSchedulePhase,
  buildAddonPriceLookupIntervals,
  buildBillingApiFeatures,
  buildStripeAddonDecreaseScheduleItems,
  createBillingApiApp,
  hasBillingApiCredentialScope,
  isBillingTestClockEnvironmentEnabled,
  isSupportedStripeBillingEventType,
  parseBillingApiCredentialScopes,
  readStripeInvoiceEventSnapshot,
  readStripeTestClockSnapshot,
  readStripeSubscriptionSnapshot,
  resolveTestClockAdvanceTarget,
  toInvoiceEventResponse,
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

  test('parses supported credential scopes and ignores unknown values', () => {
    expect(
      parseBillingApiCredentialScopes(
        JSON.stringify([
          'subject:write',
          'billing:read',
          'billing:write',
          'billing:test_clock',
          'admin:all',
        ]),
      ),
    ).toEqual(['subject:write', 'billing:read', 'billing:write', 'billing:test_clock']);
    expect(parseBillingApiCredentialScopes('{"not":"an array"}')).toEqual([]);
  });

  test('checks required credential scope', () => {
    expect(
      hasBillingApiCredentialScope({
        scopes: ['billing:read'],
        requiredScope: 'billing:read',
      }),
    ).toBe(true);
    expect(
      hasBillingApiCredentialScope({
        scopes: ['billing:read'],
        requiredScope: 'billing:write',
      }),
    ).toBe(false);
  });

  test('enables Test Clock API only for sandbox test-mode Stripe keys', () => {
    expect(
      isBillingTestClockEnvironmentEnabled({
        BILLING_TEST_CLOCKS_ENABLED: 'true',
        BILLING_API_ENV: 'sandbox',
        STRIPE_SECRET_KEY: 'sk_test_123',
      } as never),
    ).toBe(true);
    expect(
      isBillingTestClockEnvironmentEnabled({
        BILLING_TEST_CLOCKS_ENABLED: 'true',
        BILLING_API_ENV: 'production',
        STRIPE_SECRET_KEY: 'sk_test_123',
      } as never),
    ).toBe(false);
    expect(
      isBillingTestClockEnvironmentEnabled({
        BILLING_TEST_CLOCKS_ENABLED: 'true',
        BILLING_API_ENV: 'sandbox',
        STRIPE_SECRET_KEY: 'sk_live_123',
      } as never),
    ).toBe(false);
  });

  test('normalizes Stripe Test Clock payloads', () => {
    expect(
      readStripeTestClockSnapshot({
        id: 'clock_123',
        status: 'internal_failure',
        frozen_time: 1_783_000_000,
      }),
    ).toEqual({
      id: 'clock_123',
      status: 'failed',
      frozenTime: new Date('2026-07-02T13:46:40.000Z'),
    });
  });

  test('resolves Test Clock advanceBy requests from the current frozen time', () => {
    expect(
      resolveTestClockAdvanceTarget({
        currentFrozenTime: new Date('2026-06-27T00:00:00.000Z'),
        request: { advanceBy: { amount: 7, unit: 'day' } },
      })?.toISOString(),
    ).toBe('2026-07-04T00:00:00.000Z');
    expect(
      resolveTestClockAdvanceTarget({
        currentFrozenTime: new Date('2026-06-27T00:00:00.000Z'),
        request: { advanceBy: { amount: 1, unit: 'month' } },
      })?.toISOString(),
    ).toBe('2026-07-27T00:00:00.000Z');
    expect(
      resolveTestClockAdvanceTarget({
        currentFrozenTime: new Date('2026-06-27T00:00:00.000Z'),
        request: { frozenTime: '2026-07-05T00:00:00.000Z' },
      })?.toISOString(),
    ).toBe('2026-07-05T00:00:00.000Z');
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
            id: 'si_base',
            quantity: 1,
            price: {
              id: 'price_monthly',
              recurring: {
                interval: 'month',
              },
            },
          },
          {
            id: 'si_staff',
            quantity: 2,
            price: {
              id: 'price_staff_seat_monthly',
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
      items: [
        {
          id: 'si_base',
          providerPriceId: 'price_monthly',
          quantity: 1,
          interval: 'month',
        },
        {
          id: 'si_staff',
          providerPriceId: 'price_staff_seat_monthly',
          quantity: 2,
          interval: 'month',
        },
      ],
    });
    expect(snapshot?.currentPeriodStart?.toISOString()).toBe('2026-05-28T20:26:40.000Z');
    expect(snapshot?.currentPeriodEnd?.toISOString()).toBe('2026-06-27T20:26:40.000Z');
  });

  test('supports invoice finalized webhook as a billing event', () => {
    expect(isSupportedStripeBillingEventType('invoice.finalized')).toBe(true);
    expect(isSupportedStripeBillingEventType('customer.subscription.trial_will_end')).toBe(false);
  });

  test('prefers yearly addon prices but falls back to monthly addon prices', () => {
    expect(buildAddonPriceLookupIntervals('year')).toEqual(['year', 'month']);
    expect(buildAddonPriceLookupIntervals('month')).toEqual(['month']);
    expect(buildAddonPriceLookupIntervals(null)).toEqual(['month']);
  });

  test('builds future schedule items by applying pending addon decrease targets only', () => {
    expect(
      buildStripeAddonDecreaseScheduleItems({
        currentItems: [
          { providerPriceId: 'price_base_yearly', quantity: 1 },
          { providerPriceId: 'price_staff_seat_monthly', quantity: 4 },
          { providerPriceId: 'price_shop_slot_monthly', quantity: 3 },
        ],
        targets: [{ providerPriceId: 'price_staff_seat_monthly', quantity: 2 }],
      }),
    ).toEqual([
      { providerPriceId: 'price_base_yearly', quantity: 1 },
      { providerPriceId: 'price_staff_seat_monthly', quantity: 2 },
      { providerPriceId: 'price_shop_slot_monthly', quantity: 3 },
    ]);
  });

  test('uses duration instead of removed iterations for future subscription schedule phases', () => {
    const params = new URLSearchParams();

    appendStripeSubscriptionSchedulePhase({
      params,
      phaseIndex: 1,
      startDate: new Date('2026-07-23T00:00:00.000Z'),
      durationInterval: 'month',
      durationIntervalCount: 1,
      items: [{ providerPriceId: 'price_staff_seat_monthly', quantity: 2 }],
    });

    expect(params.has('phases[1][iterations]')).toBe(false);
    expect(params.get('phases[1][duration][interval]')).toBe('month');
    expect(params.get('phases[1][duration][interval_count]')).toBe('1');
  });

  test('normalizes Stripe invoice payload for invoice event history', () => {
    const snapshot = readStripeInvoiceEventSnapshot({
      eventType: 'invoice.payment_failed',
      eventCreatedAt: new Date('2026-06-26T00:00:00.000Z'),
      invoice: {
        id: 'in_123',
        status: 'open',
        payment_intent: 'pi_123',
        hosted_invoice_url: 'https://pay.stripe.test/invoice',
        invoice_pdf: 'https://pay.stripe.test/invoice.pdf',
      },
    });

    expect(snapshot).toEqual({
      eventType: 'payment_failed',
      ownerFacingStatus: 'failed',
      providerInvoiceId: 'in_123',
      providerPaymentIntentId: 'pi_123',
      providerStatus: 'open',
      hostedInvoiceUrl: 'https://pay.stripe.test/invoice',
      invoicePdfUrl: 'https://pay.stripe.test/invoice.pdf',
      occurredAt: new Date('2026-06-26T00:00:00.000Z'),
    });
  });

  test('serializes billing invoice event rows for API responses', () => {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    expect(
      toInvoiceEventResponse({
        id: 'event_1',
        appId: 'reserve',
        billingAccountId: 'account_1',
        billingSubscriptionId: 'subscription_1',
        provider: 'stripe',
        providerEventId: 'evt_1',
        eventType: 'payment_action_required',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_1',
        providerInvoiceId: 'in_1',
        providerPaymentIntentId: 'pi_1',
        providerStatus: 'open',
        ownerFacingStatus: 'action_required',
        hostedInvoiceUrl: 'https://pay.stripe.test/invoice',
        invoicePdfUrl: 'https://pay.stripe.test/invoice.pdf',
        occurredAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      } as never),
    ).toEqual({
      id: 'event_1',
      provider: 'stripe',
      providerEventId: 'evt_1',
      eventType: 'payment_action_required',
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
      providerInvoiceId: 'in_1',
      providerPaymentIntentId: 'pi_1',
      providerStatus: 'open',
      ownerFacingStatus: 'action_required',
      hostedInvoiceUrl: 'https://pay.stripe.test/invoice',
      invoicePdfUrl: 'https://pay.stripe.test/invoice.pdf',
      occurredAt: '2026-06-26T00:00:00.000Z',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
    });
  });
});
