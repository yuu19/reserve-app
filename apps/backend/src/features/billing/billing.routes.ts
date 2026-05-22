import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import { createReserveAppBillingStore } from '../../infra/billing/reserve-app-billing-store.js';
import { createReserveAppBillingOperationStore } from '../../infra/billing/reserve-app-billing-operation-store.js';
import { createStripeBillingProvider } from '../../infra/payment/stripe-billing-provider.js';
import { jsonRouteResult } from '../../shared/route-result.js';
import {
  completeTrialLifecycle,
  createSetupCheckoutHandoff,
  createSubscriptionCheckoutHandoff,
  createSubscriptionUpdatePortalHandoff,
  startTrialSubscription,
} from './billing-actions.usecase.js';
import {
  createBillingRouteContext,
  resolveE2eStripeTestClockId,
  type BillingRouteBindings,
} from './billing.route-context.js';
import { getInternalBillingInspection } from './billing-inspection.usecase.js';
import {
  createOrganizationBillingCheckoutRoute,
  createOrganizationBillingPaymentMethodRoute,
  createOrganizationBillingPortalRoute,
  createOrganizationBillingTrialCompletionRoute,
  createOrganizationBillingTrialRoute,
  getInternalBillingInspectionRoute,
  getOrganizationBillingRoute,
} from './billing.schemas.js';
import { getOrganizationBillingSummary } from './billing-summary.usecase.js';

export { resolveE2eStripeTestClockId };

type RegisterBillingRoutesOptions = {
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
};

const jsonBillingRouteResult = (...args: Parameters<typeof jsonRouteResult>) =>
  jsonRouteResult(...args) as never;

export const registerBillingRoutes = (
  authRoutes: OpenAPIHono<BillingRouteBindings>,
  { auth, database, env }: RegisterBillingRoutesOptions,
) => {
  const ctx = createBillingRouteContext({
    auth,
    database,
    env,
    store: createReserveAppBillingStore({ database, env }),
    operationStore: createReserveAppBillingOperationStore({ database }),
    createProvider: createStripeBillingProvider,
  });

  authRoutes.openapi(getOrganizationBillingRoute, async (c) =>
    jsonBillingRouteResult(
      c,
      await getOrganizationBillingSummary({
        ctx,
        query: c.req.valid('query'),
        headers: c.req.raw.headers,
      }),
    ),
  );

  authRoutes.openapi(createOrganizationBillingCheckoutRoute, async (c) =>
    jsonBillingRouteResult(
      c,
      await createSubscriptionCheckoutHandoff({
        ctx,
        body: c.req.valid('json'),
        headers: c.req.raw.headers,
      }),
    ),
  );

  authRoutes.openapi(createOrganizationBillingTrialRoute, async (c) =>
    jsonBillingRouteResult(
      c,
      await startTrialSubscription({
        ctx,
        body: c.req.valid('json'),
        headers: c.req.raw.headers,
      }),
    ),
  );

  authRoutes.openapi(createOrganizationBillingPaymentMethodRoute, async (c) =>
    jsonBillingRouteResult(
      c,
      await createSetupCheckoutHandoff({
        ctx,
        body: c.req.valid('json'),
        headers: c.req.raw.headers,
      }),
    ),
  );

  authRoutes.openapi(createOrganizationBillingPortalRoute, async (c) =>
    jsonBillingRouteResult(
      c,
      await createSubscriptionUpdatePortalHandoff({
        ctx,
        body: c.req.valid('json'),
        headers: c.req.raw.headers,
      }),
    ),
  );

  authRoutes.openapi(createOrganizationBillingTrialCompletionRoute, async (c) =>
    jsonBillingRouteResult(
      c,
      await completeTrialLifecycle({
        ctx,
        body: c.req.valid('json'),
        headers: c.req.raw.headers,
      }),
    ),
  );

  authRoutes.openapi(getInternalBillingInspectionRoute, async (c) =>
    jsonBillingRouteResult(
      c,
      await getInternalBillingInspection({
        ctx,
        params: c.req.valid('param'),
        headers: c.req.raw.headers,
      }),
    ),
  );
};
