import type { BookingRouteContext } from '../booking/booking-route-context.js';
import { jsonRouteResult } from '../../shared/route-result.js';
import {
  cancelSlotRoute,
  createSlotRoute,
  listAvailableSlotsRoute,
  listSlotsRoute,
  updateSlotPublicStatusRoute,
  updateSlotRoute,
} from './slot.schemas.js';
import {
  cancelExistingSlot,
  createSlot,
  listParticipantAvailableSlots,
  listStaffSlots,
  updateExistingSlot,
  updateExistingSlotPublicStatus,
} from './slot.usecases.js';

/**
 * slot の作成・更新・一覧・参加者向け空き枠・キャンセル route を登録します。
 */
export const registerSlotRoutes = (ctx: BookingRouteContext) => {
  const withScope = <T extends Record<string, unknown>>(
    scope: NonNullable<Awaited<ReturnType<BookingRouteContext['resolveScopedStoreContext']>>>,
    input: T,
  ) => ({
    ...input,
    organizationId: scope.organizationId,
    storeId: scope.storeId,
  });

  ctx.authRoutes.openapi(createSlotRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(c, await createSlot(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers));
  });

  ctx.authRoutes.openapi(updateSlotRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await updateExistingSlot(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(updateSlotPublicStatusRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await updateExistingSlotPublicStatus(
        ctx,
        withScope(scope, c.req.valid('json')),
        c.req.raw.headers,
      ),
    );
  });

  ctx.authRoutes.openapi(listSlotsRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await listStaffSlots(ctx, withScope(scope, c.req.valid('query')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(listAvailableSlotsRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await listParticipantAvailableSlots(
        ctx,
        withScope(scope, c.req.valid('query')),
        c.req.raw.headers,
      ),
    );
  });

  ctx.authRoutes.openapi(cancelSlotRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await cancelExistingSlot(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });
};
