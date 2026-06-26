import { describe, expect, it, vi } from 'vitest';
import type { AuthInstance, AuthRuntimeDatabase } from '../auth-runtime.js';
import { createApp, shouldForwardStripeBillingWebhookToBillingApi } from './create-app.js';

const hmacSha256Hex = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const createStripeSignatureHeader = async (payload: string, secret: string) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return `t=${timestamp},v1=${signature}`;
};

const createTestApp = ({
  stripeWebhookSecret,
  billingApiBaseUrl,
}: {
  stripeWebhookSecret: string;
  billingApiBaseUrl: string;
}) =>
  createApp({
    auth: {
      handler: vi.fn(async () => new Response('auth')),
    } as unknown as AuthInstance,
    authTrustedOrigins: ['http://localhost:5173'],
    database: {} as AuthRuntimeDatabase,
    env: {
      STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
      BILLING_API_WEBHOOK_FORWARD_ENABLED: 'true',
      BILLING_API_BASE_URL: billingApiBaseUrl,
    },
  });

describe('createApp Stripe webhook Billing API forwarding', () => {
  it('Billing API metadata を持つ Checkout webhook だけを Billing API 転送対象にする', () => {
    expect(
      shouldForwardStripeBillingWebhookToBillingApi({
        id: 'evt_billing_checkout',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_billing_checkout',
            metadata: {
              appId: 'reserve',
              subjectType: 'organization',
              subjectId: 'organization-1',
              billingPurpose: 'subscription_checkout',
            },
          },
        },
      }),
    ).toBe(true);

    expect(
      shouldForwardStripeBillingWebhookToBillingApi({
        id: 'evt_ticket_checkout',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_ticket_checkout',
            metadata: {
              purchaseId: 'ticket-purchase-1',
            },
          },
        },
      }),
    ).toBe(false);
  });

  it('Billing API 未対応の legacy notification webhook は backend 側に残す', () => {
    expect(
      shouldForwardStripeBillingWebhookToBillingApi({
        id: 'evt_trial_will_end',
        type: 'customer.subscription.trial_will_end',
        data: {
          object: {
            id: 'sub_trial',
          },
        },
      }),
    ).toBe(false);

    expect(
      shouldForwardStripeBillingWebhookToBillingApi({
        id: 'evt_invoice_payment_failed',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_failed',
          },
        },
      }),
    ).toBe(true);
  });

  it('署名検証後に raw Stripe webhook body を Billing API へ転送する', async () => {
    const stripeWebhookSecret = 'whsec_test_forward';
    const billingApiBaseUrl = 'https://billing-api.test/';
    const app = createTestApp({ stripeWebhookSecret, billingApiBaseUrl });
    const payload = JSON.stringify({
      id: 'evt_forward_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_forward',
          metadata: {
            appId: 'reserve',
            subjectType: 'organization',
            subjectId: 'organization-1',
          },
        },
      },
    });
    const signature = await createStripeSignatureHeader(payload, stripeWebhookSecret);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    try {
      const response = await app.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: payload,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ received: true });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://billing-api.test/api/v1/webhooks/stripe/billing',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'stripe-signature': signature,
          },
          body: payload,
        },
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});
