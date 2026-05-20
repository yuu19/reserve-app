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
  ctx.authRoutes.openapi(createRecurringScheduleRoute, async (c) =>
    jsonRouteResult(c, await createRecurringSchedule(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(listRecurringSchedulesRoute, async (c) =>
    jsonRouteResult(
      c,
      await listManageableRecurringSchedules(ctx, c.req.valid('query'), c.req.raw.headers),
    ),
  );

  ctx.authRoutes.openapi(updateRecurringScheduleRoute, async (c) =>
    jsonRouteResult(
      c,
      await updateExistingRecurringSchedule(ctx, c.req.valid('json'), c.req.raw.headers),
    ),
  );

  ctx.authRoutes.openapi(upsertRecurringExceptionRoute, async (c) =>
    jsonRouteResult(
      c,
      await upsertExistingRecurringException(ctx, c.req.valid('json'), c.req.raw.headers),
    ),
  );

  ctx.authRoutes.openapi(generateRecurringSlotsRoute, async (c) =>
    jsonRouteResult(c, await generateRecurringSlots(ctx, c.req.valid('json'), c.req.raw.headers)),
  );
};
