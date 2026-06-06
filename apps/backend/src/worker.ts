import * as Sentry from '@sentry/cloudflare';
import { createWorkerAuthRuntime, type BackendWorkerEnv } from './auth-worker.js';
import { cleanupExpiredAiConversationContent } from './features/ai/conversation-store.js';
import { processDueNotificationOutbox } from './features/booking/booking.notifications.js';
import { runDailyBookingMaintenance } from './domain/booking/scheduler.js';
import {
  completeExpiredOrganizationPremiumTrials,
  reconcileProviderLinkedOrganizationBillingStates,
  reconcileRiskyOrganizationBillingStates,
  sendPastDueGraceExpiryReminders,
} from './domain/billing/organization-billing-maintenance.js';
import { createApp } from './app/create-app.js';
import { createOrganizationLogoService } from './infra/storage/organization-logo-service.js';
import { createServiceImageUploadService } from './infra/storage/service-image-upload-service.js';

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
    event: unknown,
    env: BackendWorkerEnv,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) {
    const runtime = getWorkerRuntime(env);
    const cron =
      typeof event === 'object' && event !== null ? (event as { cron?: string }).cron : null;
    const reminderJobs = [
      processDueNotificationOutbox({
        database: runtime.database,
        env: runtime.env,
      }),
    ];
    const dailyJobs =
      cron === '10 18 * * *' || !cron
        ? [
            runDailyBookingMaintenance({
              database: runtime.database,
            }),
            completeExpiredOrganizationPremiumTrials({
              database: runtime.database,
              env: runtime.env,
            }),
            sendPastDueGraceExpiryReminders({
              database: runtime.database,
              env: runtime.env,
            }),
            reconcileRiskyOrganizationBillingStates({
              database: runtime.database,
              env: runtime.env,
            }),
            reconcileProviderLinkedOrganizationBillingStates({
              database: runtime.database,
              env: runtime.env,
            }),
            cleanupExpiredAiConversationContent({
              database: runtime.database,
            }),
          ]
        : [];
    ctx.waitUntil(Promise.all([...reminderJobs, ...dailyJobs]));
  },
};

export default Sentry.withSentry((env: BackendWorkerEnv) => {
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
}, handler);
