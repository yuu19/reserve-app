import * as Sentry from '@sentry/cloudflare';
import { createWorkerAuthRuntime, type BackendWorkerEnv } from './auth-worker.js';
import { runDailyBookingMaintenance } from './booking/scheduler.js';
import { createApp } from './app.js';
import { createOrganizationLogoService } from './organization-logo-service.js';
import { createServiceImageUploadService } from './service-image-upload-service.js';

let workerApp: ReturnType<typeof createApp> | null = null;
let workerRuntime: ReturnType<typeof createWorkerAuthRuntime> | null = null;

const getWorkerRuntime = (env: BackendWorkerEnv) => {
  if (!workerRuntime) {
    workerRuntime = createWorkerAuthRuntime(env);
  }

  return workerRuntime;
};

const getWorkerApp = (env: BackendWorkerEnv) => {
  if (!workerApp) {
    const authRuntime = getWorkerRuntime(env);
    const organizationLogoService = createOrganizationLogoService(env);
    const serviceImageUploadService = createServiceImageUploadService(env);
    workerApp = createApp({
      ...authRuntime,
      organizationLogoService,
      serviceImageUploadService,
    });
  }

  return workerApp;
};

const handler = {
  fetch(request: Request, env: BackendWorkerEnv) {
    return getWorkerApp(env).fetch(request, env);
  },
  async scheduled(
    _event: unknown,
    env: BackendWorkerEnv,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) {
    const runtime = getWorkerRuntime(env);
    ctx.waitUntil(
      runDailyBookingMaintenance({
        database: runtime.database,
      }),
    );
  },
};

export default Sentry.withSentry(
  (env: BackendWorkerEnv) => {
    if (!env.SENTRY_DSN_BACKEND) {
      return undefined;
    }

    return {
      dsn: env.SENTRY_DSN_BACKEND,
      environment: env.SENTRY_ENVIRONMENT ?? 'production',
      release: env.SENTRY_RELEASE,
      tracesSampleRate: 0.05,
      sendDefaultPii: false,
    };
  },
  handler,
);
