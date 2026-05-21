import { canViewOrganizationBillingByRole } from '../../domain/booking/authorization.js';
import {
  forbidden,
  jsonResult,
  unauthorized,
  validationError,
  type JsonRouteResult,
} from '../../shared/route-result.js';
import type { BillingRouteContext } from './billing.route-context.js';
import type { OrganizationBillingQuery } from './billing.schemas.js';
import { readOrganizationBillingSummaryPayload } from './billing.presenter.js';

export const getOrganizationBillingSummary = async ({
  ctx,
  query,
  headers,
}: {
  ctx: BillingRouteContext;
  query: OrganizationBillingQuery;
  headers: Headers;
}): Promise<JsonRouteResult> => {
  const identity = await ctx.getSessionIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const organizationId = ctx.resolveOrganizationId({
    requestedOrganizationId: query.organizationId,
    activeOrganizationId: identity.activeOrganizationId,
  });
  if (!organizationId) {
    return validationError('organizationId is required.');
  }

  const role = await ctx.readOrganizationMembershipRole({
    organizationId,
    userId: identity.userId,
  });
  if (!canViewOrganizationBillingByRole(role)) {
    return forbidden();
  }

  return jsonResult(
    await readOrganizationBillingSummaryPayload({
      store: ctx.store,
      env: ctx.env,
      organizationId,
      role,
    }),
    200,
  );
};
