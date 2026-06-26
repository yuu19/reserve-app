import { swaggerUI } from '@hono/swagger-ui';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import {
  handleStripeOrganizationBillingWebhook,
  recordStripeWebhookPayloadFailure,
  recordStripeWebhookSignatureFailure,
} from '../domain/billing/stripe-webhook-sync.js';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import { handleLegacyTicketCheckoutWebhook } from '../features/tickets/legacy-ticket-checkout-webhook.usecase.js';
import type { OrganizationLogoService } from '../infra/storage/organization-logo-service.js';
import {
  parseStripeWebhookEvent,
  type StripeWebhookEvent,
  verifyStripeWebhookSignatureDetailed,
} from '../infra/payment/stripe.js';
import { createAuthRoutes } from '../routes/auth-routes.js';
import { createAiRoutes } from '../routes/ai-routes.js';
import { createPublicRoutes } from '../routes/public-routes.js';
import type { ServiceImageUploadService } from '../infra/storage/service-image-upload-service.js';

type CreateAppOptions = {
  auth: AuthInstance;
  authTrustedOrigins: string[];
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationLogoService?: OrganizationLogoService | null;
  serviceImageUploadService?: ServiceImageUploadService | null;
};

const trimBaseUrl = (value: string) => value.replace(/\/+$/, '');

const billingApiForwardableStripeEvents = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.payment_action_required',
]);

const readRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const readStripeMetadata = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(readRecord(value))
      .map(([key, entry]) => [key, typeof entry === 'string' ? entry.trim() : ''])
      .filter(([, entry]) => entry.length > 0),
  );

const readCheckoutBillingMetadata = (event: StripeWebhookEvent): Record<string, string> => {
  const object = readRecord(event.data?.object);
  const subscriptionDetails = readRecord(object.subscription_details);
  return {
    ...readStripeMetadata(subscriptionDetails.metadata),
    ...readStripeMetadata(object.metadata),
  };
};

const hasBillingApiCheckoutMetadata = (event: StripeWebhookEvent): boolean => {
  const metadata = readCheckoutBillingMetadata(event);
  return Boolean(
    metadata.billingAccountId ||
    (metadata.appId && metadata.subjectType && metadata.subjectId) ||
    metadata.billingPurpose === 'subscription_checkout' ||
    metadata.billingPurpose === 'payment_method_setup',
  );
};

export const shouldForwardStripeBillingWebhookToBillingApi = (
  event: StripeWebhookEvent,
): boolean => {
  if (event.type === 'checkout.session.completed') {
    return hasBillingApiCheckoutMetadata(event);
  }
  return billingApiForwardableStripeEvents.has(event.type);
};

const forwardStripeBillingWebhookToBillingApi = async ({
  env,
  rawBody,
  signatureHeader,
}: {
  env: AuthRuntimeEnv;
  rawBody: string;
  signatureHeader: string;
}): Promise<
  | {
      ok: true;
      body: unknown;
    }
  | {
      ok: false;
      status: 502 | 503;
      message: string;
    }
> => {
  const baseUrl = env.BILLING_API_BASE_URL?.trim();
  if (!baseUrl) {
    return {
      ok: false,
      status: 503,
      message: 'Billing API base URL is not configured for Stripe webhook forwarding.',
    };
  }

  try {
    const response = await fetch(`${trimBaseUrl(baseUrl)}/api/v1/webhooks/stripe/billing`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signatureHeader,
      },
      body: rawBody,
    });
    const text = await response.text();
    const body = text ? (JSON.parse(text) as unknown) : { received: true };
    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        message:
          typeof body === 'object' &&
          body !== null &&
          'error' in body &&
          typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
            ? (body as { error: { message: string } }).error.message
            : `Billing API webhook forwarding failed with status ${response.status}.`,
      };
    }
    return { ok: true, body };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      message: error instanceof Error ? error.message : 'Billing API webhook forwarding failed.',
    };
  }
};

/**
 * Better Auth、OpenAPI route、公開 route、Stripe webhook、機能別 route を
 * 単一の D1-backed runtime に束ねて Worker の HTTP 窓口を構成する。
 *
 * @param options - Worker runtime から注入する依存。
 * @param options.auth - Better Auth instance。
 * @param options.authTrustedOrigins - CORS と Better Auth が許可する origin 一覧。
 * @param options.database - route と webhook が共有する D1-backed Drizzle database。
 * @param options.env - Backend runtime の環境変数。
 * @param options.organizationLogoService - organization logo の読み書きを扱う service。
 * @param options.serviceImageUploadService - service image の署名付き upload を扱う service。
 * @returns Hono RPC と OpenAPI route を登録済みの application instance。
 *
 * @example
 * ```typescript
 * const app = createApp({
 *   auth,
 *   authTrustedOrigins,
 *   database,
 *   env,
 * });
 * ```
 */
export const createApp = ({
  auth,
  authTrustedOrigins,
  database,
  env,
  organizationLogoService,
  serviceImageUploadService,
}: CreateAppOptions) => {
  const app = new OpenAPIHono();

  app.use('*', async (c, next) => {
    await next();

    const pathname = new URL(c.req.url).pathname;
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

    if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/v1/auth/oidc/')) {
      c.res.headers.set('Cache-Control', 'no-store');
      c.res.headers.set('Referrer-Policy', 'no-referrer');
    } else {
      c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    }
  });

  app.use(
    '/api/*',
    cors({
      origin: authTrustedOrigins,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }),
  );

  app.get('/', (c) => {
    return c.text('Hono + Better Auth API');
  });

  app.get('/robots.txt', (c) => {
    return c.text('User-agent: *\nDisallow: /\n');
  });

  const healthRoute = createRoute({
    method: 'get',
    path: '/api/health',
    tags: ['System'],
    summary: 'Health check',
    responses: {
      200: {
        description: 'Service is healthy',
        content: {
          'application/json': {
            schema: z.object({ ok: z.literal(true) }),
          },
        },
      },
    },
  });

  app.openapi(healthRoute, (c) => {
    return c.json({ ok: true }, 200);
  });

  app.doc('/api/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'Backend API',
      version: '1.0.0',
      description: 'Hono RPC + OpenAPI + Better Auth endpoints',
    },
  });

  app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));

  app.post('/api/webhooks/stripe', async (c) => {
    const rawBody = await c.req.text();
    const signatureHeader = c.req.header('stripe-signature') ?? null;
    const signatureStatus = await verifyStripeWebhookSignatureDetailed({
      rawBody,
      signatureHeader,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    });
    if (signatureStatus !== 'verified') {
      await recordStripeWebhookSignatureFailure({
        database,
        signatureStatus,
      });
      return c.json({ message: 'Invalid Stripe signature.' }, 400);
    }

    const event = parseStripeWebhookEvent(rawBody);
    if (!event) {
      await recordStripeWebhookPayloadFailure({
        database,
      });
      return c.json({ message: 'Invalid Stripe payload.' }, 400);
    }

    if (
      env.BILLING_API_WEBHOOK_FORWARD_ENABLED === 'true' &&
      shouldForwardStripeBillingWebhookToBillingApi(event)
    ) {
      const forwardResult = await forwardStripeBillingWebhookToBillingApi({
        env,
        rawBody,
        signatureHeader: signatureHeader ?? '',
      });
      if (!forwardResult.ok) {
        return c.json({ message: forwardResult.message }, forwardResult.status);
      }
      return c.json(forwardResult.body, 200);
    }

    const billingWebhook = await handleStripeOrganizationBillingWebhook({
      database,
      env,
      event,
    });
    if (billingWebhook.matched) {
      if (billingWebhook.statusCode === 500) {
        // 再試行可能な organization billing の失敗は、webhook 受領記録を失敗として残したうえで
        // Stripe に再送させるため 5xx として返す。
        return c.json(
          {
            message: billingWebhook.message ?? 'Stripe webhook processing should be retried.',
          },
          500,
        );
      }
      return c.json({ received: true }, 200);
    }

    await handleLegacyTicketCheckoutWebhook({
      database,
      event,
    });
    return c.json({ received: true }, 200);
  });

  const authRoutes = createAuthRoutes(auth, {
    database,
    env,
    organizationLogoService: organizationLogoService ?? null,
    serviceImageUploadService: serviceImageUploadService ?? null,
  });
  const publicRoutes = createPublicRoutes({
    database,
    env,
  });
  const { aiRoutes, internalAiRoutes } = createAiRoutes({
    auth,
    database,
    env,
  });

  app.route('/api/v1/auth', authRoutes);
  app.route('/api/v1/public', publicRoutes);
  app.route('/api/v1/ai', aiRoutes);
  app.route('/api/v1/internal/ai', internalAiRoutes);

  app.on(['GET', 'POST', 'OPTIONS'], '/api/auth/*', (c) => {
    return auth.handler(c.req.raw);
  });

  return app;
};

/** Hono RPC client が参照する backend application 型。 */
export type AppType = ReturnType<typeof createApp>;
