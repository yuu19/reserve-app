import { swaggerUI } from '@hono/swagger-ui';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, eq, or, type SQL } from 'drizzle-orm';
import { cors } from 'hono/cors';
import { TICKET_LEDGER_ACTION, TICKET_PACK_STATUS, TICKET_PURCHASE_STATUS } from './booking/constants.js';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from './auth-runtime.js';
import * as dbSchema from './db/schema.js';
import type { OrganizationLogoService } from './organization-logo-service.js';
import {
  parseStripeWebhookEvent,
  readStripeBillingCheckoutMetadata,
  readStripeCheckoutSessionSummary,
  readStripeSubscriptionSummary,
  verifyStripeWebhookSignature,
} from './payment/stripe.js';
import { createAuthRoutes } from './routes/auth-routes.js';
import { createPublicRoutes } from './routes/public-routes.js';
import type { ServiceImageUploadService } from './service-image-upload-service.js';

type CreateAppOptions = {
  auth: AuthInstance;
  authTrustedOrigins: string[];
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationLogoService?: OrganizationLogoService | null;
  serviceImageUploadService?: ServiceImageUploadService | null;
};

export const createApp = ({
  auth,
  authTrustedOrigins,
  database,
  env,
  organizationLogoService,
  serviceImageUploadService,
}: CreateAppOptions) => {
  const app = new OpenAPIHono();

  const normalizePackStatus = ({
    remainingCount,
    expiresAt,
  }: {
    remainingCount: number;
    expiresAt: Date | null;
  }): string => {
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      return TICKET_PACK_STATUS.EXPIRED;
    }
    if (remainingCount <= 0) {
      return TICKET_PACK_STATUS.EXHAUSTED;
    }
    return TICKET_PACK_STATUS.ACTIVE;
  };

  const resolveEndDate = (ticketTypeExpiresInDays: number | null): Date | null => {
    if (typeof ticketTypeExpiresInDays === 'number' && ticketTypeExpiresInDays > 0) {
      return new Date(Date.now() + ticketTypeExpiresInDays * 24 * 60 * 60 * 1000);
    }
    return null;
  };

  const resolveBillingIntervalFromPriceId = (priceId: string | null): 'month' | 'year' | null => {
    if (!priceId) {
      return null;
    }
    if (env.STRIPE_PREMIUM_MONTHLY_PRICE_ID?.trim() === priceId) {
      return 'month';
    }
    if (env.STRIPE_PREMIUM_YEARLY_PRICE_ID?.trim() === priceId) {
      return 'year';
    }
    return null;
  };

  const ensureOrganizationBillingRow = async (organizationId: string) => {
    await database
      .insert(dbSchema.organizationBilling)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        planCode: 'free',
        subscriptionStatus: 'free',
      })
      .onConflictDoNothing();
  };

  const upsertOrganizationBillingByOrganizationId = async ({
    organizationId,
    planCode,
    stripeCustomerId,
    stripeSubscriptionId,
    stripePriceId,
    billingInterval,
    subscriptionStatus,
    cancelAtPeriodEnd,
    currentPeriodStart,
    currentPeriodEnd,
  }: {
    organizationId: string;
    planCode: 'free' | 'premium';
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripePriceId?: string | null;
    billingInterval?: 'month' | 'year' | null;
    subscriptionStatus: 'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete';
    cancelAtPeriodEnd?: boolean;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
  }) => {
    await ensureOrganizationBillingRow(organizationId);
    await database
      .insert(dbSchema.organizationBilling)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        planCode,
        stripeCustomerId: stripeCustomerId ?? null,
        stripeSubscriptionId: stripeSubscriptionId ?? null,
        stripePriceId: stripePriceId ?? null,
        billingInterval: billingInterval ?? null,
        subscriptionStatus,
        cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
        currentPeriodStart: currentPeriodStart ?? null,
        currentPeriodEnd: currentPeriodEnd ?? null,
      })
      .onConflictDoUpdate({
        target: dbSchema.organizationBilling.organizationId,
        set: {
          planCode,
          stripeCustomerId: stripeCustomerId ?? null,
          stripeSubscriptionId: stripeSubscriptionId ?? null,
          stripePriceId: stripePriceId ?? null,
          billingInterval: billingInterval ?? null,
          subscriptionStatus,
          cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
          currentPeriodStart: currentPeriodStart ?? null,
          currentPeriodEnd: currentPeriodEnd ?? null,
          updatedAt: new Date(),
        },
      });
  };

  const selectOrganizationBillingByStripeIdentifiers = async ({
    stripeCustomerId,
    stripeSubscriptionId,
  }: {
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  }) => {
    const filters: SQL[] = [];
    if (stripeSubscriptionId) {
      filters.push(eq(dbSchema.organizationBilling.stripeSubscriptionId, stripeSubscriptionId));
    }
    if (stripeCustomerId) {
      filters.push(eq(dbSchema.organizationBilling.stripeCustomerId, stripeCustomerId));
    }
    if (filters.length === 0) {
      return null;
    }

    const rows = await database
      .select({
        organizationId: dbSchema.organizationBilling.organizationId,
      })
      .from(dbSchema.organizationBilling)
      .where(filters.length === 1 ? filters[0] : or(...filters))
      .limit(1);

    return rows[0] ?? null;
  };

  app.use(
    '/api/*',
    cors({
      origin: authTrustedOrigins,
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }),
  );

  app.get('/', (c) => {
    return c.text('Hono + Better Auth API');
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
    const isValidSignature = await verifyStripeWebhookSignature({
      rawBody,
      signatureHeader,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    });
    if (!isValidSignature) {
      return c.json({ message: 'Invalid Stripe signature.' }, 400);
    }

    const event = parseStripeWebhookEvent(rawBody);
    if (!event) {
      return c.json({ message: 'Invalid Stripe payload.' }, 400);
    }
    if (event.type === 'checkout.session.completed') {
      const session = readStripeCheckoutSessionSummary(event.data?.object ?? null);
      if (!session) {
        return c.json({ received: true }, 200);
      }

      const billingMetadata = readStripeBillingCheckoutMetadata(session.metadata);
      if (billingMetadata) {
        await upsertOrganizationBillingByOrganizationId({
          organizationId: billingMetadata.organizationId,
          planCode: 'premium',
          stripeCustomerId: session.customerId,
          stripeSubscriptionId: session.subscriptionId,
          stripePriceId:
            billingMetadata.billingInterval === 'month'
              ? env.STRIPE_PREMIUM_MONTHLY_PRICE_ID?.trim() ?? null
              : env.STRIPE_PREMIUM_YEARLY_PRICE_ID?.trim() ?? null,
          billingInterval: billingMetadata.billingInterval,
          subscriptionStatus: 'incomplete',
          cancelAtPeriodEnd: false,
          currentPeriodStart: null,
          currentPeriodEnd: null,
        });
        return c.json({ received: true }, 200);
      }

      const metadataPurchaseId =
        typeof session.metadata.purchaseId === 'string' && session.metadata.purchaseId.length > 0
          ? session.metadata.purchaseId
          : null;

      if (!metadataPurchaseId && !session.id) {
        return c.json({ received: true }, 200);
      }

      const purchaseRows = await database
        .select({
          id: dbSchema.ticketPurchase.id,
          organizationId: dbSchema.ticketPurchase.organizationId,
          classroomId: dbSchema.ticketPurchase.classroomId,
          participantId: dbSchema.ticketPurchase.participantId,
          ticketTypeId: dbSchema.ticketPurchase.ticketTypeId,
          status: dbSchema.ticketPurchase.status,
          ticketPackId: dbSchema.ticketPurchase.ticketPackId,
        })
        .from(dbSchema.ticketPurchase)
        .where(
          metadataPurchaseId
            ? eq(dbSchema.ticketPurchase.id, metadataPurchaseId)
            : eq(dbSchema.ticketPurchase.stripeCheckoutSessionId, session.id),
        )
        .limit(1);
      const purchase = purchaseRows[0];
      if (!purchase) {
        return c.json({ received: true }, 200);
      }
      if (purchase.status === TICKET_PURCHASE_STATUS.APPROVED && purchase.ticketPackId) {
        return c.json({ received: true }, 200);
      }
      if (purchase.status !== TICKET_PURCHASE_STATUS.PENDING_PAYMENT) {
        return c.json({ received: true }, 200);
      }

      const [ticketTypeRows, participantRows] = await Promise.all([
        database
          .select({
            totalCount: dbSchema.ticketType.totalCount,
            expiresInDays: dbSchema.ticketType.expiresInDays,
          })
          .from(dbSchema.ticketType)
          .where(eq(dbSchema.ticketType.id, purchase.ticketTypeId))
          .limit(1),
        database
          .select({
            userId: dbSchema.participant.userId,
          })
          .from(dbSchema.participant)
          .where(eq(dbSchema.participant.id, purchase.participantId))
          .limit(1),
      ]);
      const ticketType = ticketTypeRows[0];
      const participant = participantRows[0];
      if (!ticketType || !participant) {
        console.warn(`[stripe-webhook] purchase context missing: purchaseId=${purchase.id}`);
        return c.json({ received: true }, 200);
      }

      const count = ticketType.totalCount;
      const expiresAt = resolveEndDate(ticketType.expiresInDays);
      const ticketPackId = crypto.randomUUID();
      const packStatus = normalizePackStatus({
        remainingCount: count,
        expiresAt,
      });

      await database.insert(dbSchema.ticketPack).values({
        id: ticketPackId,
        organizationId: purchase.organizationId,
        classroomId: purchase.classroomId,
        participantId: purchase.participantId,
        ticketTypeId: purchase.ticketTypeId,
        initialCount: count,
        remainingCount: count,
        expiresAt,
        status: packStatus,
      });

      await database.insert(dbSchema.ticketLedger).values({
        id: crypto.randomUUID(),
        organizationId: purchase.organizationId,
        classroomId: purchase.classroomId,
        ticketPackId,
        bookingId: null,
        action: TICKET_LEDGER_ACTION.GRANT,
        delta: count,
        balanceAfter: count,
        actorUserId: participant.userId,
        reason: 'purchase-approved-by-stripe',
      });

      const updatedRows = await database
        .update(dbSchema.ticketPurchase)
        .set({
          status: TICKET_PURCHASE_STATUS.APPROVED,
          ticketPackId,
          approvedAt: new Date(),
        })
        .where(
          and(
            eq(dbSchema.ticketPurchase.id, purchase.id),
            eq(dbSchema.ticketPurchase.status, TICKET_PURCHASE_STATUS.PENDING_PAYMENT),
          ),
        )
        .returning({
          id: dbSchema.ticketPurchase.id,
        });

      if (!updatedRows[0]) {
        await database
          .delete(dbSchema.ticketLedger)
          .where(eq(dbSchema.ticketLedger.ticketPackId, ticketPackId));
        await database.delete(dbSchema.ticketPack).where(eq(dbSchema.ticketPack.id, ticketPackId));
      }

      return c.json({ received: true }, 200);
    }

    if (
      event.type === 'customer.subscription.created'
      || event.type === 'customer.subscription.updated'
      || event.type === 'customer.subscription.deleted'
    ) {
      const subscription = readStripeSubscriptionSummary(event.data?.object ?? null);
      if (!subscription) {
        return c.json({ received: true }, 200);
      }

      const matchedBilling = await selectOrganizationBillingByStripeIdentifiers({
        stripeCustomerId: subscription.customerId,
        stripeSubscriptionId: subscription.id,
      });
      if (!matchedBilling) {
        return c.json({ received: true }, 200);
      }

      const normalizedStatus = (() => {
        switch (subscription.status) {
          case 'trialing':
          case 'active':
          case 'past_due':
          case 'canceled':
          case 'unpaid':
          case 'incomplete':
            return subscription.status;
          default:
            return null;
        }
      })();
      if (!normalizedStatus) {
        return c.json({ received: true }, 200);
      }

      const isCanceled = normalizedStatus === 'canceled';
      await upsertOrganizationBillingByOrganizationId({
        organizationId: matchedBilling.organizationId,
        planCode: isCanceled ? 'free' : 'premium',
        stripeCustomerId: subscription.customerId,
        stripeSubscriptionId: isCanceled ? null : subscription.id,
        stripePriceId: isCanceled ? null : subscription.priceId,
        billingInterval: isCanceled ? null : resolveBillingIntervalFromPriceId(subscription.priceId),
        subscriptionStatus: isCanceled ? 'canceled' : normalizedStatus,
        cancelAtPeriodEnd: isCanceled ? false : subscription.cancelAtPeriodEnd,
        currentPeriodStart: isCanceled ? null : subscription.currentPeriodStart,
        currentPeriodEnd: isCanceled ? null : subscription.currentPeriodEnd,
      });

      return c.json({ received: true }, 200);
    }

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

  app.route('/api/v1/auth', authRoutes);
  app.route('/api/v1/public', publicRoutes);

  app.on(['GET', 'POST', 'OPTIONS'], '/api/auth/*', (c) => {
    return auth.handler(c.req.raw);
  });

  return app;
};

export type AppType = ReturnType<typeof createApp>;
