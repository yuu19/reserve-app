import { swaggerUI } from '@hono/swagger-ui';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from './auth-runtime.js';
import type { OrganizationLogoService } from './organization-logo-service.js';
import { createAuthRoutes } from './routes/auth-routes.js';

type CreateAppOptions = {
  auth: AuthInstance;
  authTrustedOrigins: string[];
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationLogoService?: OrganizationLogoService | null;
};

export const createApp = ({
  auth,
  authTrustedOrigins,
  database,
  env,
  organizationLogoService,
}: CreateAppOptions) => {
  const app = new OpenAPIHono();

  app.use(
    '/api/*',
    cors({
      origin: authTrustedOrigins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
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

  const authRoutes = createAuthRoutes(auth, {
    database,
    env,
    organizationLogoService: organizationLogoService ?? null,
  });
  const rpcApp = app.route('/api/v1/auth', authRoutes);

  app.on(['GET', 'POST', 'OPTIONS'], '/api/auth/*', (c) => {
    return auth.handler(c.req.raw);
  });

  return rpcApp;
};

export type AppType = ReturnType<typeof createApp>;
