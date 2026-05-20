import { findParticipantByUserAndOrganization } from '../../domain/booking/authorization.js';
import { writeBookingAuditLog } from '../../domain/booking/audit.js';
import {
  BOOKING_STATUS,
  DEFAULT_CANCELLATION_DEADLINE_MINUTES,
} from '../../domain/booking/constants.js';
import { isRequestedClassroomMismatch } from '../../shared/classroom-policy.js';
import {
  conflict,
  forbidden,
  jsonResult,
  notFound,
  unauthorized,
  type JsonRouteResult,
} from '../../shared/route-result.js';
import type { BookingRouteContext } from './booking-route-context.js';
import {
  cancelBookingByParticipantState,
  cancelBookingByStaffState,
  findBookingForParticipantCancel,
  findBookingScope,
  findServiceCancellationPolicy,
  findSlotStart,
  markConfirmedBookingNoShow,
  releaseConfirmedBookingSlotCapacity,
  restoreTicketPackForBookingCancel,
} from './booking.repository.js';
import { notifyBookingEmailBestEffort } from './booking.notifications.js';
import type { BookingActionBody, BookingNoShowBody } from './booking.schemas.js';

/**
 * participant 本人の予約をキャンセルし、確定予約では定員と ticket pack を復元します。
 */
export const cancelBookingByParticipant = async (
  ctx: BookingRouteContext,
  body: BookingActionBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const booking = await findBookingForParticipantCancel(ctx.database, body.bookingId);
  if (!booking) {
    return notFound('Booking not found.');
  }

  if (isRequestedClassroomMismatch(body.classroomId, booking.classroomId)) {
    return forbidden();
  }

  const participant = await findParticipantByUserAndOrganization({
    database: ctx.database,
    organizationId: booking.organizationId,
    classroomId: body.classroomId ?? booking.classroomId,
    userId: identity.userId,
  });
  if (!participant || participant.id !== booking.participantId) {
    return forbidden();
  }

  const isPendingApproval = booking.status === BOOKING_STATUS.PENDING_APPROVAL;
  if (!isPendingApproval && booking.status !== BOOKING_STATUS.CONFIRMED) {
    return conflict('Booking cannot be canceled.');
  }

  if (!isPendingApproval) {
    const slot = await findSlotStart(ctx.database, booking.slotId);
    if (!slot) {
      return notFound('Slot not found.');
    }

    const service = await findServiceCancellationPolicy(ctx.database, booking.serviceId);
    const cancellationDeadlineMinutes =
      service?.cancellationDeadlineMinutes ?? DEFAULT_CANCELLATION_DEADLINE_MINUTES;
    const deadlineAt = new Date(
      new Date(slot.startAt).getTime() - cancellationDeadlineMinutes * 60 * 1000,
    );
    if (Date.now() > deadlineAt.getTime()) {
      return conflict('Cancellation deadline has passed.');
    }
  }

  await cancelBookingByParticipantState({
    database: ctx.database,
    bookingId: booking.id,
    reason: body.reason,
    actorUserId: identity.userId,
  });

  if (!isPendingApproval) {
    await releaseConfirmedBookingSlotCapacity({
      database: ctx.database,
      slotId: booking.slotId,
      participantsCount: booking.participantsCount,
    });

    if (booking.ticketPackId) {
      await restoreTicketPackForBookingCancel({
        database: ctx.database,
        organizationId: booking.organizationId,
        classroomId: booking.classroomId,
        ticketPackId: booking.ticketPackId,
        bookingId: booking.id,
        participantsCount: booking.participantsCount,
        actorUserId: identity.userId,
        reason: 'booking-canceled-by-participant',
      });
    }
  }

  await writeBookingAuditLog({
    database: ctx.database,
    bookingId: booking.id,
    organizationId: booking.organizationId,
    classroomId: booking.classroomId,
    actorUserId: identity.userId,
    action: 'booking.cancelled_by_participant',
    metadata: {
      reason: body.reason ?? null,
    },
    headers,
  });

  await notifyBookingEmailBestEffort({
    database: ctx.database,
    env: ctx.env,
    bookingId: booking.id,
    event: 'booking_cancelled_by_participant',
    reason: body.reason ?? null,
  });

  return jsonResult({ ok: true });
};

/**
 * staff が確定予約をキャンセルし、定員・ticket pack・監査ログ・通知を反映します。
 */
export const cancelBookingByStaff = async (
  ctx: BookingRouteContext,
  body: BookingActionBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const booking = await findBookingScope(ctx.database, body.bookingId);
  if (!booking) {
    return notFound('Booking not found.');
  }

  if (isRequestedClassroomMismatch(body.classroomId, booking.classroomId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageBookingsScope({
    organizationId: booking.organizationId,
    classroomId: booking.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  if (booking.status !== BOOKING_STATUS.CONFIRMED) {
    return conflict('Booking cannot be canceled.');
  }

  await cancelBookingByStaffState({
    database: ctx.database,
    bookingId: booking.id,
    reason: body.reason,
    actorUserId: identity.userId,
  });

  await releaseConfirmedBookingSlotCapacity({
    database: ctx.database,
    slotId: booking.slotId,
    participantsCount: booking.participantsCount,
  });

  await writeBookingAuditLog({
    database: ctx.database,
    bookingId: booking.id,
    organizationId: booking.organizationId,
    classroomId: booking.classroomId,
    actorUserId: identity.userId,
    action: 'booking.cancelled_by_staff',
    metadata: {
      reason: body.reason ?? null,
    },
    headers,
  });

  await notifyBookingEmailBestEffort({
    database: ctx.database,
    env: ctx.env,
    bookingId: booking.id,
    event: 'booking_cancelled_by_staff',
    reason: body.reason ?? null,
  });

  return jsonResult({ ok: true });
};

/**
 * staff が確定予約を no-show に遷移させ、監査ログと通知を残します。
 */
export const markBookingNoShow = async (
  ctx: BookingRouteContext,
  body: BookingNoShowBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const booking = await findBookingScope(ctx.database, body.bookingId);
  if (!booking) {
    return notFound('Booking not found.');
  }

  if (isRequestedClassroomMismatch(body.classroomId, booking.classroomId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageBookingsScope({
    organizationId: booking.organizationId,
    classroomId: booking.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  if (booking.status !== BOOKING_STATUS.CONFIRMED) {
    return conflict('Only confirmed booking can be marked as no-show.');
  }

  await markConfirmedBookingNoShow({
    database: ctx.database,
    bookingId: booking.id,
  });

  await writeBookingAuditLog({
    database: ctx.database,
    bookingId: booking.id,
    organizationId: booking.organizationId,
    classroomId: booking.classroomId,
    actorUserId: identity.userId,
    action: 'booking.no_show',
    headers,
  });

  await notifyBookingEmailBestEffort({
    database: ctx.database,
    env: ctx.env,
    bookingId: booking.id,
    event: 'booking_no_show',
  });

  return jsonResult({ ok: true });
};
