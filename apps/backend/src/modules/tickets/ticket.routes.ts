import type { BookingRouteContext } from '../shared/route-context.js';
import { jsonRouteResult } from '../shared/route-result.js';
import {
  approveTicketPurchaseRoute,
  cancelTicketPurchaseRoute,
  createTicketPurchaseRoute,
  createTicketTypeRoute,
  grantTicketPackRoute,
  listMyTicketPacksRoute,
  listMyTicketPurchasesRoute,
  listPurchasableTicketTypesRoute,
  listTicketPurchasesRoute,
  listTicketTypesRoute,
  rejectTicketPurchaseRoute,
} from './ticket.schemas.js';
import {
  approveTicketPurchase,
  cancelExistingTicketPurchase,
  createTicketPurchase,
  createTicketType,
  grantTicketPack,
  listManageableTicketTypes,
  listMyTicketPacks,
  listMyTicketPurchases,
  listPurchasableTicketTypeOptions,
  listStaffTicketPurchases,
  rejectExistingTicketPurchase,
} from './ticket.usecases.js';

export const registerTicketRoutes = (ctx: BookingRouteContext) => {
  ctx.authRoutes.openapi(createTicketTypeRoute, async (c) =>
    jsonRouteResult(c, await createTicketType(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(listTicketTypesRoute, async (c) =>
    jsonRouteResult(
      c,
      await listManageableTicketTypes(ctx, c.req.valid('query'), c.req.raw.headers),
    ),
  );

  ctx.authRoutes.openapi(listPurchasableTicketTypesRoute, async (c) =>
    jsonRouteResult(
      c,
      await listPurchasableTicketTypeOptions(ctx, c.req.valid('query'), c.req.raw.headers),
    ),
  );

  ctx.authRoutes.openapi(createTicketPurchaseRoute, async (c) =>
    jsonRouteResult(c, await createTicketPurchase(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(listMyTicketPurchasesRoute, async (c) =>
    jsonRouteResult(c, await listMyTicketPurchases(ctx, c.req.valid('query'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(listTicketPurchasesRoute, async (c) =>
    jsonRouteResult(
      c,
      await listStaffTicketPurchases(ctx, c.req.valid('query'), c.req.raw.headers),
    ),
  );

  ctx.authRoutes.openapi(approveTicketPurchaseRoute, async (c) =>
    jsonRouteResult(c, await approveTicketPurchase(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(rejectTicketPurchaseRoute, async (c) =>
    jsonRouteResult(
      c,
      await rejectExistingTicketPurchase(ctx, c.req.valid('json'), c.req.raw.headers),
    ),
  );

  ctx.authRoutes.openapi(cancelTicketPurchaseRoute, async (c) =>
    jsonRouteResult(
      c,
      await cancelExistingTicketPurchase(ctx, c.req.valid('json'), c.req.raw.headers),
    ),
  );

  ctx.authRoutes.openapi(grantTicketPackRoute, async (c) =>
    jsonRouteResult(c, await grantTicketPack(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(listMyTicketPacksRoute, async (c) =>
    jsonRouteResult(c, await listMyTicketPacks(ctx, c.req.valid('query'), c.req.raw.headers)),
  );
};
