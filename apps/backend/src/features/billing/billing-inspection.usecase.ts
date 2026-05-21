import {
  canAccessInternalBillingInspection,
  INTERNAL_BILLING_INSPECTION_DENIED_MESSAGE,
} from '../../domain/billing/internal-operator-access.js';
import {
  jsonResult,
  notFound,
  unauthorized,
  type JsonRouteResult,
} from '../../shared/route-result.js';
import type { BillingRouteContext } from './billing.route-context.js';
import type { InternalBillingInspectionParams } from './billing.schemas.js';

export const getInternalBillingInspection = async ({
  ctx,
  params,
  headers,
}: {
  ctx: BillingRouteContext;
  params: InternalBillingInspectionParams;
  headers: Headers;
}): Promise<JsonRouteResult> => {
  const identity = await ctx.getSessionIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  if (
    !canAccessInternalBillingInspection({
      env: ctx.env,
      email: identity.email,
      emailVerified: identity.emailVerified,
    })
  ) {
    return jsonResult({ message: INTERNAL_BILLING_INSPECTION_DENIED_MESSAGE }, 403);
  }

  const inspection = await ctx.store.readInternalInspection({
    organizationId: params.organizationId,
  });
  if (!inspection) {
    return notFound('Organization not found.');
  }

  return jsonResult(inspection, 200);
};
