import type { BookingRouteContext } from '../shared/route-context.js';
import { jsonRouteResult } from '../shared/route-result.js';
import {
  cancelSlotRoute,
  createSlotRoute,
  listAvailableSlotsRoute,
  listSlotsRoute,
  updateSlotRoute,
} from './slot.schemas.js';
import {
  cancelExistingSlot,
  createSlot,
  listParticipantAvailableSlots,
  listStaffSlots,
  updateExistingSlot,
} from './slot.usecases.js';

export const registerSlotRoutes = (ctx: BookingRouteContext) => {
  ctx.authRoutes.openapi(createSlotRoute, async (c) =>
    jsonRouteResult(c, await createSlot(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(updateSlotRoute, async (c) =>
    jsonRouteResult(c, await updateExistingSlot(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(listSlotsRoute, async (c) =>
    jsonRouteResult(c, await listStaffSlots(ctx, c.req.valid('query'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(listAvailableSlotsRoute, async (c) =>
    jsonRouteResult(
      c,
      await listParticipantAvailableSlots(ctx, c.req.valid('query'), c.req.raw.headers),
    ),
  );

  ctx.authRoutes.openapi(cancelSlotRoute, async (c) =>
    jsonRouteResult(c, await cancelExistingSlot(ctx, c.req.valid('json'), c.req.raw.headers)),
  );
};
