import { describe, expect, it } from 'vitest';
import {
  createOrganizationBillingCheckoutRoute,
  createOrganizationBillingPaymentMethodRoute,
  createOrganizationBillingPortalRoute,
  createOrganizationBillingTrialCompletionRoute,
  createOrganizationBillingTrialRoute,
  getInternalBillingInspectionRoute,
  getOrganizationBillingRoute,
  organizationBillingActionResponseSchema,
  organizationBillingCheckoutBodySchema,
} from './billing.schemas.js';

const responseStatuses = (route: { responses: Record<string | number, unknown> }) =>
  Object.keys(route.responses).sort((left, right) => Number(left) - Number(right));

describe('billing route compatibility', () => {
  it('keeps existing billing paths, methods and response status sets', () => {
    expect(
      [
        getOrganizationBillingRoute,
        createOrganizationBillingCheckoutRoute,
        createOrganizationBillingTrialRoute,
        createOrganizationBillingPaymentMethodRoute,
        createOrganizationBillingPortalRoute,
        createOrganizationBillingTrialCompletionRoute,
        getInternalBillingInspectionRoute,
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
    ]);
  });

  it('keeps checkout request and action response wire shape', () => {
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
});
