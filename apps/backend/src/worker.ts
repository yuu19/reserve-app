import { createWorkerAuthRuntime, type BackendWorkerEnv } from './auth-worker.js';
import { runDailyBookingMaintenance } from './booking/scheduler.js';
import { createApp } from './app.js';
import { createOrganizationLogoService } from './organization-logo-service.js';

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
    workerApp = createApp({
      ...authRuntime,
      organizationLogoService,
    });
  }

  return workerApp;
};

export default {
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
