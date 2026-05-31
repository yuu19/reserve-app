import type { BookingRouteContext } from './booking-route-context.js';
import { jsonRouteResult } from '../../shared/route-result.js';
import {
  approveBookingByStaffRoute,
  cancelBookingByStaffRoute,
  cancelBookingRoute,
  createBookingRoute,
  listBookingsRoute,
  listMyBookingsRoute,
  markAttendanceRoute,
  markNoShowRoute,
  rejectBookingByStaffRoute,
  staffCreateBookingRoute,
} from './booking.schemas.js';
import {
  approveBookingByStaff,
  cancelBookingByParticipant,
  cancelBookingByStaff,
  createBooking,
  listMyBookings,
  listStaffBookings,
  markBookingAttendance,
  markBookingNoShow,
  rejectBookingByStaff,
} from './booking.usecases.js';
import { createBookingByStaff } from './staff-create-booking.usecase.js';

/**
 * 予約の申込から承認、キャンセル、無断欠席までの lifecycle route を登録します。
 */
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

  ctx.authRoutes.openapi(markAttendanceRoute, async (c) =>
    jsonRouteResult(c, await markBookingAttendance(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(staffCreateBookingRoute, async (c) =>
    jsonRouteResult(
      c,
      await createBookingByStaff(ctx, c.req.valid('param'), c.req.valid('json'), c.req.raw.headers),
    ),
  );
};
