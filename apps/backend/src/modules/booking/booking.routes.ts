import type { BookingRouteContext } from '../shared/route-context.js';
import { jsonRouteResult } from '../shared/route-result.js';
import {
  approveBookingByStaffRoute,
  cancelBookingByStaffRoute,
  cancelBookingRoute,
  createBookingRoute,
  listBookingsRoute,
  listMyBookingsRoute,
  markNoShowRoute,
  rejectBookingByStaffRoute,
} from './booking.schemas.js';
import {
  approveBookingByStaff,
  cancelBookingByParticipant,
  cancelBookingByStaff,
  createBooking,
  listMyBookings,
  listStaffBookings,
  markBookingNoShow,
  rejectBookingByStaff,
} from './booking.usecases.js';

export const registerBookingLifecycleRoutes = (ctx: BookingRouteContext) => {
  ctx.authRoutes.openapi(createBookingRoute, async (c) =>
    jsonRouteResult(c, await createBooking(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(listMyBookingsRoute, async (c) =>
    jsonRouteResult(c, await listMyBookings(ctx, c.req.valid('query'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(cancelBookingRoute, async (c) =>
    jsonRouteResult(
      c,
      await cancelBookingByParticipant(ctx, c.req.valid('json'), c.req.raw.headers),
    ),
  );

  ctx.authRoutes.openapi(listBookingsRoute, async (c) =>
    jsonRouteResult(c, await listStaffBookings(ctx, c.req.valid('query'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(cancelBookingByStaffRoute, async (c) =>
    jsonRouteResult(c, await cancelBookingByStaff(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(approveBookingByStaffRoute, async (c) =>
    jsonRouteResult(c, await approveBookingByStaff(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(rejectBookingByStaffRoute, async (c) =>
    jsonRouteResult(c, await rejectBookingByStaff(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(markNoShowRoute, async (c) =>
    jsonRouteResult(c, await markBookingNoShow(ctx, c.req.valid('json'), c.req.raw.headers)),
  );
};
