import { swaggerUI } from '@hono/swagger-ui';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { cors } from 'hono/cors';
import {
  TICKET_LEDGER_ACTION,
  TICKET_PACK_STATUS,
  TICKET_PURCHASE_STATUS,
} from './booking/constants.js';
import {
  handleStripeOrganizationBillingWebhook,
  recordStripeWebhookPayloadFailure,
  recordStripeWebhookSignatureFailure,
} from './billing/stripe-webhook-sync.js';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from './auth-runtime.js';
import * as dbSchema from './db/schema.js';
import type { OrganizationLogoService } from './organization-logo-service.js';
import {
  parseStripeWebhookEvent,
  readStripeCheckoutSessionSummary,
  verifyStripeWebhookSignatureDetailed,
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

  app.use(
    '/api/*',
    cors({
      origin: authTrustedOrigins,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
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

    const billingWebhook = await handleStripeOrganizationBillingWebhook({
      database,
      env,
      event,
    });
    if (billingWebhook.matched) {
      if (billingWebhook.statusCode === 500) {
        return c.json(
          {
            message: billingWebhook.message ?? 'Stripe webhook processing should be retried.',
          },
          500,
        );
      }
      return c.json({ received: true }, 200);
    }

    // Legacy ticket purchase checkout sessions are no longer created by the API.
    // Keep this branch so already-issued sessions can complete without manual recovery.
    if (event.type === 'checkout.session.completed') {
      const session = readStripeCheckoutSessionSummary(event.data?.object ?? null);
      if (!session) {
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
