import type { BookingRouteContext } from '../booking/booking-route-context.js';
import { jsonRouteResult } from '../../shared/route-result.js';
import {
  createRecurringScheduleRoute,
  generateRecurringSlotsRoute,
  listRecurringSchedulesRoute,
  updateRecurringScheduleRoute,
  upsertRecurringExceptionRoute,
} from './recurring.schemas.js';
import {
  createRecurringSchedule,
  generateRecurringSlots,
  listManageableRecurringSchedules,
  updateExistingRecurringSchedule,
  upsertExistingRecurringException,
} from './recurring.usecases.js';

/**
 * recurring schedule と例外日、手動 slot 生成の route を登録します。
 */
export const registerRecurringRoutes = (ctx: BookingRouteContext) => {
  const withScope = <T extends Record<string, unknown>>(
    scope: NonNullable<Awaited<ReturnType<BookingRouteContext['resolveScopedStoreContext']>>>,
    input: T,
  ) => ({
    ...input,
    organizationId: scope.organizationId,
    storeId: scope.storeId,
  });

  ctx.authRoutes.openapi(createRecurringScheduleRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await createRecurringSchedule(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(listRecurringSchedulesRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await listManageableRecurringSchedules(
        ctx,
        withScope(scope, c.req.valid('query')),
        c.req.raw.headers,
      ),
    );
  });

  ctx.authRoutes.openapi(updateRecurringScheduleRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await updateExistingRecurringSchedule(
        ctx,
        withScope(scope, c.req.valid('json')),
        c.req.raw.headers,
      ),
    );
  });

  ctx.authRoutes.openapi(upsertRecurringExceptionRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await upsertExistingRecurringException(
        ctx,
        withScope(scope, c.req.valid('json')),
        c.req.raw.headers,
      ),
    );
  });

  ctx.authRoutes.openapi(generateRecurringSlotsRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await generateRecurringSlots(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });
};
