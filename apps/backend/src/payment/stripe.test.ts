import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBillingPortalSession,
  createSubscriptionCheckoutSession,
  readStripeSubscriptionSummary,
} from './stripe.js';

const env = {
  STRIPE_SECRET_KEY: 'sk_test_unit',
};

const readHeader = (headers: HeadersInit | undefined, name: string) => {
  if (!headers) {
    return null;
  }
  return new Headers(headers).get(name);
};

describe('Stripe billing adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends idempotency keys and organization metadata for subscription checkout sessions', async () => {
    let capturedBody = '';
    let capturedHeaders: HeadersInit | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : '';
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          id: 'cs_test_subscription',
          url: 'https://checkout.stripe.com/c/cs_test_subscription',
          payment_status: 'unpaid',
          status: 'open',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    await expect(
      createSubscriptionCheckoutSession({
        env,
        priceId: 'price_monthly',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        customerId: 'cus_test',
        clientReferenceId: 'org_123',
        idempotencyKey: 'billing-operation-123',
        metadata: {
          billingPurpose: 'organization_plan',
          organizationId: 'org_123',
          billingInterval: 'month',
        },
      }),
    ).resolves.toMatchObject({
      id: 'cs_test_subscription',
      url: 'https://checkout.stripe.com/c/cs_test_subscription',
      paymentStatus: 'unpaid',
      status: 'open',
    });

    const params = new URLSearchParams(capturedBody);
    expect(readHeader(capturedHeaders, 'idempotency-key')).toBe('billing-operation-123');
    expect(params.get('mode')).toBe('subscription');
    expect(params.get('customer')).toBe('cus_test');
    expect(params.get('client_reference_id')).toBe('org_123');
    expect(params.get('metadata[billingPurpose]')).toBe('organization_plan');
    expect(params.get('metadata[organizationId]')).toBe('org_123');
    expect(params.get('metadata[billingInterval]')).toBe('month');
  });

  it('sends idempotency keys and subscription update flow data for billing portal sessions', async () => {
    let capturedBody = '';
    let capturedHeaders: HeadersInit | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : '';
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          id: 'bps_test',
          url: 'https://billing.stripe.com/p/session',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    await expect(
      createBillingPortalSession({
        env,
        customerId: 'cus_portal',
        returnUrl: 'https://example.com/contracts',
        idempotencyKey: 'billing-portal-operation-123',
        subscriptionUpdate: {
          subscriptionId: 'sub_portal',
          afterCompletionReturnUrl: 'https://example.com/contracts?subscription=success',
        },
      }),
    ).resolves.toEqual({
      id: 'bps_test',
      url: 'https://billing.stripe.com/p/session',
    });

    const params = new URLSearchParams(capturedBody);
    expect(readHeader(capturedHeaders, 'idempotency-key')).toBe('billing-portal-operation-123');
    expect(params.get('customer')).toBe('cus_portal');
    expect(params.get('return_url')).toBe('https://example.com/contracts');
    expect(params.get('flow_data[type]')).toBe('subscription_update');
    expect(params.get('flow_data[subscription_update][subscription]')).toBe('sub_portal');
    expect(params.get('flow_data[after_completion][type]')).toBe('redirect');
    expect(params.get('flow_data[after_completion][redirect][return_url]')).toBe(
      'https://example.com/contracts?subscription=success',
    );
  });

  it('normalizes provider subscription summaries without exposing raw Stripe payloads', () => {
    const summary = readStripeSubscriptionSummary({
      id: 'sub_summary',
      customer: 'cus_summary',
      status: 'past_due',
      cancel_at_period_end: true,
      items: {
        data: [
          {
            current_period_start: 1775000000,
            current_period_end: 1777688400,
            price: {
              id: 'price_summary',
            },
          },
        ],
      },
    });

    expect(summary).toMatchObject({
      id: 'sub_summary',
      customerId: 'cus_summary',
      status: 'past_due',
      cancelAtPeriodEnd: true,
      priceId: 'price_summary',
    });
    expect(summary?.currentPeriodStart?.toISOString()).toBe('2026-03-31T23:33:20.000Z');
    expect(summary?.currentPeriodEnd?.toISOString()).toBe('2026-05-02T02:20:00.000Z');
  });
});
