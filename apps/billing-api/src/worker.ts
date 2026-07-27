import { createBillingApiApp } from './app.js';
import { dispatchPendingBillingEvents, type BillingEventQueue } from './billing-event-outbox.js';
import { createBillingApiDatabase } from './db/database.js';

type BillingApiWorkerEnv = {
  DB: D1Database;
  BILLING_EVENT_QUEUE?: BillingEventQueue;
};

const app = createBillingApiApp();

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: BillingApiWorkerEnv, ctx: ExecutionContext): void {
    ctx.waitUntil(
      dispatchPendingBillingEvents({
        db: createBillingApiDatabase(env.DB),
        queue: env.BILLING_EVENT_QUEUE,
      }),
    );
  },
};
