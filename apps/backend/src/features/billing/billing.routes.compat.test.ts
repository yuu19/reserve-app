import { describe, expect, it } from 'vitest';
import {
  advanceInternalBillingTestClockScenarioRoute,
  createInternalBillingTestClockScenarioRoute,
  createOrganizationBillingCheckoutRoute,
  createOrganizationBillingPaymentMethodRoute,
  createOrganizationBillingPortalRoute,
  createOrganizationBillingTrialCompletionRoute,
  createOrganizationBillingTrialRoute,
  getInternalBillingTestClockScenarioRoute,
  getInternalBillingInspectionRoute,
  getOrganizationBillingRoute,
  internalBillingTestClockScenarioAdvanceBodySchema,
  internalBillingTestClockScenarioCreateBodySchema,
  organizationBillingAddonItemsIdempotencyHeadersSchema,
  organizationBillingActionResponseSchema,
  organizationBillingCheckoutBodySchema,
} from './billing.schemas.js';

const responseStatuses = (route: { responses: Record<string | number, unknown> }) =>
  Object.keys(route.responses).sort((left, right) => Number(left) - Number(right));

describe('課金ルート互換性', () => {
  it('既存の課金パス・メソッド・レスポンスステータス集合を維持する', () => {
    expect(
      [
        getOrganizationBillingRoute,
        createOrganizationBillingCheckoutRoute,
        createOrganizationBillingTrialRoute,
        createOrganizationBillingPaymentMethodRoute,
        createOrganizationBillingPortalRoute,
        createOrganizationBillingTrialCompletionRoute,
        getInternalBillingInspectionRoute,
        createInternalBillingTestClockScenarioRoute,
        getInternalBillingTestClockScenarioRoute,
        advanceInternalBillingTestClockScenarioRoute,
      ].map((route) => ({
        method: route.method,
        path: route.path,
        responses: responseStatuses(route),
      })),
    ).toEqual([
      {
        method: 'get',
        path: '/organizations/billing',
        responses: ['200', '401', '403', '422'],
      },
      {
        method: 'post',
        path: '/organizations/billing/checkout',
        responses: ['200', '401', '403', '409', '422', '500'],
      },
      {
        method: 'post',
        path: '/organizations/billing/trial',
        responses: ['200', '401', '403', '409', '422', '500'],
      },
      {
        method: 'post',
        path: '/organizations/billing/payment-method',
        responses: ['200', '401', '403', '409', '422', '500'],
      },
      {
        method: 'post',
        path: '/organizations/billing/portal',
        responses: ['200', '401', '403', '409', '422', '500'],
      },
      {
        method: 'post',
        path: '/organizations/billing/trial/complete',
        responses: ['200', '401', '403', '409', '422', '503'],
      },
      {
        method: 'get',
        path: '/internal/organizations/{organizationId}/billing-inspection',
        responses: ['200', '401', '403', '404'],
      },
      {
        method: 'post',
        path: '/internal/organizations/{organizationId}/billing-test-clock-scenarios',
        responses: ['200', '400', '401', '403', '404', '409', '422', '503'],
      },
      {
        method: 'get',
        path: '/internal/organizations/{organizationId}/billing-test-clock-scenarios/{scenarioId}',
        responses: ['200', '401', '403', '404', '422', '503'],
      },
      {
        method: 'post',
        path: '/internal/organizations/{organizationId}/billing-test-clock-scenarios/{scenarioId}/advance',
        responses: ['200', '400', '401', '403', '404', '409', '422', '503'],
      },
    ]);
  });

  it('Checkout リクエストとアクションレスポンスのワイヤー形状を維持する', () => {
    expect(
      organizationBillingCheckoutBodySchema.parse({
        organizationId: 'organization-1',
        billingInterval: 'month',
      }),
    ).toEqual({
      organizationId: 'organization-1',
      billingInterval: 'month',
    });

    expect(
      organizationBillingActionResponseSchema.parse({
        status: 'processing',
        message: 'Stripe Checkout handoff is ready.',
        billing: null,
        handoff: {
          provider: 'stripe',
          purpose: 'paid_checkout',
          url: 'https://stripe.test/checkout',
          expiresAt: '2026-05-21T00:30:00.000Z',
          reused: false,
          operationAttemptId: 'attempt-1',
        },
        url: 'https://stripe.test/checkout',
      }),
    ).toMatchObject({
      status: 'processing',
      message: 'Stripe Checkout handoff is ready.',
      billing: null,
      handoff: {
        provider: 'stripe',
        purpose: 'paid_checkout',
        url: 'https://stripe.test/checkout',
        reused: false,
      },
      url: 'https://stripe.test/checkout',
    });
  });

  it('addon 更新の Idempotency-Key は必須かつ安全な文字だけを許可する', () => {
    expect(
      organizationBillingAddonItemsIdempotencyHeadersSchema.parse({
        'idempotency-key': '019f657a-32d3-7fd2-8339-5ea257d20479',
      }),
    ).toEqual({
      'idempotency-key': '019f657a-32d3-7fd2-8339-5ea257d20479',
    });
    expect(organizationBillingAddonItemsIdempotencyHeadersSchema.safeParse({}).success).toBe(false);
    expect(
      organizationBillingAddonItemsIdempotencyHeadersSchema.safeParse({
        'idempotency-key': 'contains spaces',
      }).success,
    ).toBe(false);
    expect(
      organizationBillingAddonItemsIdempotencyHeadersSchema.safeParse({
        'idempotency-key': 'a'.repeat(129),
      }).success,
    ).toBe(false);
  });

  it('Billing API Test Clock リクエストのワイヤー形状を維持する', () => {
    expect(
      internalBillingTestClockScenarioCreateBodySchema.parse({
        scenarioType: 'trial_expired_without_payment_method',
        frozenTime: '2026-06-28T00:00:00.000Z',
        planCode: 'premium',
        interval: 'month',
        trialDays: 7,
      }),
    ).toEqual({
      scenarioType: 'trial_expired_without_payment_method',
      frozenTime: '2026-06-28T00:00:00.000Z',
      planCode: 'premium',
      interval: 'month',
      trialDays: 7,
    });

    expect(
      internalBillingTestClockScenarioAdvanceBodySchema.parse({
        advanceBy: {
          amount: 7,
          unit: 'day',
        },
      }),
    ).toEqual({
      advanceBy: {
        amount: 7,
        unit: 'day',
      },
    });
  });
});
