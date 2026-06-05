import type { BookingRouteContext } from '../booking/booking-route-context.js';
import { jsonRouteResult } from '../../shared/route-result.js';
import {
  adjustTicketPackRoute,
  approveTicketPurchaseRoute,
  cancelTicketPurchaseRoute,
  createTicketPurchaseRoute,
  createTicketTypeRoute,
  grantTicketPackRoute,
  listMyTicketPacksRoute,
  listMyTicketPurchasesRoute,
  listPurchasableTicketTypesRoute,
  listTicketPacksRoute,
  listTicketPurchasesRoute,
  listTicketTypesRoute,
  rejectTicketPurchaseRoute,
  updateTicketTypeRoute,
} from './ticket.schemas.js';
import {
  adjustExistingTicketPack,
  approveTicketPurchase,
  cancelExistingTicketPurchase,
  createTicketPurchase,
  createTicketType,
  grantTicketPack,
  listManageableTicketTypes,
  listMyTicketPacks,
  listMyTicketPurchases,
  listPurchasableTicketTypeOptions,
  listStaffTicketPacks,
  listStaffTicketPurchases,
  rejectExistingTicketPurchase,
  updateExistingTicketType,
} from './ticket.usecases.js';

/**
 * ticket type、purchase、pack の管理・参加者向け route を登録します。
 */
export const registerTicketRoutes = (ctx: BookingRouteContext) => {
  const withScope = <T extends Record<string, unknown>>(
    scope: NonNullable<Awaited<ReturnType<BookingRouteContext['resolveScopedStoreContext']>>>,
    input: T,
  ) => ({
    ...input,
    organizationId: scope.organizationId,
    storeId: scope.storeId,
  });

  ctx.authRoutes.openapi(createTicketTypeRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await createTicketType(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(updateTicketTypeRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await updateExistingTicketType(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(listTicketTypesRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await listManageableTicketTypes(ctx, withScope(scope, c.req.valid('query')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(listPurchasableTicketTypesRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await listPurchasableTicketTypeOptions(
        ctx,
        withScope(scope, c.req.valid('query')),
        c.req.raw.headers,
      ),
    );
  });

  ctx.authRoutes.openapi(createTicketPurchaseRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await createTicketPurchase(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(listMyTicketPurchasesRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await listMyTicketPurchases(ctx, withScope(scope, c.req.valid('query')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(listTicketPurchasesRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await listStaffTicketPurchases(ctx, withScope(scope, c.req.valid('query')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(approveTicketPurchaseRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await approveTicketPurchase(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(rejectTicketPurchaseRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await rejectExistingTicketPurchase(
        ctx,
        withScope(scope, c.req.valid('json')),
        c.req.raw.headers,
      ),
    );
  });

  ctx.authRoutes.openapi(cancelTicketPurchaseRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await cancelExistingTicketPurchase(
        ctx,
        withScope(scope, c.req.valid('json')),
        c.req.raw.headers,
      ),
    );
  });

  ctx.authRoutes.openapi(grantTicketPackRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await grantTicketPack(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(listTicketPacksRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await listStaffTicketPacks(ctx, withScope(scope, c.req.valid('query')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(adjustTicketPackRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await adjustExistingTicketPack(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(listMyTicketPacksRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await listMyTicketPacks(ctx, withScope(scope, c.req.valid('query')), c.req.raw.headers),
    );
  });
};
