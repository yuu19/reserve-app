import type { BookingRouteContext } from '../shared/route-context.js';
import { jsonRouteResult } from '../shared/route-result.js';
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
