import { findParticipantByUserAndOrganization } from '../../domain/booking/authorization.js';
import { writeBookingAuditLog } from '../../domain/booking/audit.js';
import {
  BOOKING_AUDIT_ACTION,
  BOOKING_ATTENDANCE_STATUS,
  BOOKING_STATUS,
  DEFAULT_CANCELLATION_DEADLINE_MINUTES,
} from '../../domain/booking/constants.js';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { runDatabaseTransactionOrThrow } from '../../infra/db/transaction.js';
import { canTransitionBookingStatus, isBookingStatus } from '../../domain/booking/state.js';
import { isRequestedStoreMismatch } from '../../shared/store-policy.js';
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
  markConfirmedBookingAttendance,
  markConfirmedBookingNoShow,
  releaseConfirmedBookingSlotCapacity,
  restoreTicketPackForBookingCancel,
} from './booking.repository.js';
import {
  cancelPendingBookingReminderOutboxes,
  enqueueBookingCustomerNotificationOutbox,
  enqueueBookingOperationalNotificationOutbox,
} from './booking.notifications.js';
import type {
  BookingActionBody,
  BookingAttendanceBody,
  BookingNoShowBody,
} from './booking.schemas.js';

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

  if (isRequestedStoreMismatch(body.storeId, booking.storeId)) {
    return forbidden();
  }

  const participant = await findParticipantByUserAndOrganization({
    database: ctx.database,
    organizationId: booking.organizationId,
    storeId: body.storeId ?? booking.storeId,
    userId: identity.userId,
  });
  if (!participant || participant.id !== booking.participantId) {
    return forbidden();
  }

  const isPendingApproval = booking.status === BOOKING_STATUS.PENDING_APPROVAL;
  if (
    !isBookingStatus(booking.status) ||
    (!isPendingApproval && booking.status !== BOOKING_STATUS.CONFIRMED) ||
    !canTransitionBookingStatus(booking.status, BOOKING_STATUS.CANCELLED)
  ) {
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

  try {
    await runDatabaseTransactionOrThrow(ctx.database, async (tx: AuthRuntimeDatabase) => {
      const updated = await cancelBookingByParticipantState({
        database: tx,
        bookingId: booking.id,
        reason: body.reason,
        actorUserId: identity.userId,
      });
      if (!updated) {
        throw new Error('BOOKING_CANCEL_CONFLICT');
      }

      if (!isPendingApproval) {
        await releaseConfirmedBookingSlotCapacity({
          database: tx,
          slotId: booking.slotId,
          participantsCount: booking.participantsCount,
        });

        if (booking.ticketPackId) {
          await restoreTicketPackForBookingCancel({
            database: tx,
            organizationId: booking.organizationId,
            storeId: booking.storeId,
            ticketPackId: booking.ticketPackId,
            bookingId: booking.id,
            participantsCount: booking.participantsCount,
            actorUserId: identity.userId,
            reason: 'booking-canceled-by-participant',
          });
        }
      }

      await writeBookingAuditLog({
        database: tx,
        bookingId: booking.id,
        organizationId: booking.organizationId,
        storeId: booking.storeId,
        actorUserId: identity.userId,
        action: BOOKING_AUDIT_ACTION.CANCELLED_BY_CUSTOMER,
        metadata: {
          reason: body.reason ?? null,
        },
        headers,
      });

      await cancelPendingBookingReminderOutboxes({
        database: tx,
        bookingId: booking.id,
        includeProcessing: true,
      });

      await Promise.all([
        enqueueBookingCustomerNotificationOutbox({
          database: tx,
          bookingId: booking.id,
          event: 'booking_cancelled_by_participant',
          reason: body.reason ?? null,
        }),
        enqueueBookingOperationalNotificationOutbox({
          database: tx,
          bookingId: booking.id,
          event: 'booking_cancelled_by_participant',
          reason: body.reason ?? null,
        }),
      ]);
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'BOOKING_CANCEL_CONFLICT') {
      return conflict('Booking cannot be canceled.');
    }
    throw error;
  }

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

  if (isRequestedStoreMismatch(body.storeId, booking.storeId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageBookingsScope({
    organizationId: booking.organizationId,
    storeId: booking.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  if (
    !isBookingStatus(booking.status) ||
    booking.status !== BOOKING_STATUS.CONFIRMED ||
    !canTransitionBookingStatus(booking.status, BOOKING_STATUS.CANCELLED)
  ) {
    return conflict('Booking cannot be canceled.');
  }

  try {
    await runDatabaseTransactionOrThrow(ctx.database, async (tx: AuthRuntimeDatabase) => {
      const updated = await cancelBookingByStaffState({
        database: tx,
        bookingId: booking.id,
        reason: body.reason,
        actorUserId: identity.userId,
      });
      if (!updated) {
        throw new Error('BOOKING_CANCEL_CONFLICT');
      }

      await releaseConfirmedBookingSlotCapacity({
        database: tx,
        slotId: booking.slotId,
        participantsCount: booking.participantsCount,
      });

      await writeBookingAuditLog({
        database: tx,
        bookingId: booking.id,
        organizationId: booking.organizationId,
        storeId: booking.storeId,
        actorUserId: identity.userId,
        action: BOOKING_AUDIT_ACTION.CANCELLED_BY_STAFF,
        metadata: {
          reason: body.reason ?? null,
        },
        headers,
      });

      await cancelPendingBookingReminderOutboxes({
        database: tx,
        bookingId: booking.id,
        includeProcessing: true,
      });

      await Promise.all([
        enqueueBookingCustomerNotificationOutbox({
          database: tx,
          bookingId: booking.id,
          event: 'booking_cancelled_by_staff',
          reason: body.reason ?? null,
        }),
        enqueueBookingOperationalNotificationOutbox({
          database: tx,
          bookingId: booking.id,
          event: 'booking_cancelled_by_staff',
          reason: body.reason ?? null,
        }),
      ]);
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'BOOKING_CANCEL_CONFLICT') {
      return conflict('Booking cannot be canceled.');
    }
    throw error;
  }

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

  if (isRequestedStoreMismatch(body.storeId, booking.storeId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageBookingsScope({
    organizationId: booking.organizationId,
    storeId: booking.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  if (
    !isBookingStatus(booking.status) ||
    booking.status !== BOOKING_STATUS.CONFIRMED ||
    !canTransitionBookingStatus(booking.status, BOOKING_STATUS.NO_SHOW)
  ) {
    return conflict('Only confirmed booking can be marked as no-show.');
  }

  try {
    await runDatabaseTransactionOrThrow(ctx.database, async (tx: AuthRuntimeDatabase) => {
      const updated = await markConfirmedBookingNoShow({
        database: tx,
        bookingId: booking.id,
        actorUserId: identity.userId,
      });
      if (!updated) {
        throw new Error('BOOKING_NO_SHOW_CONFLICT');
      }

      await writeBookingAuditLog({
        database: tx,
        bookingId: booking.id,
        organizationId: booking.organizationId,
        storeId: booking.storeId,
        actorUserId: identity.userId,
        action: BOOKING_AUDIT_ACTION.NO_SHOW_MARKED,
        headers,
      });

      await cancelPendingBookingReminderOutboxes({
        database: tx,
        bookingId: booking.id,
      });

      await enqueueBookingCustomerNotificationOutbox({
        database: tx,
        bookingId: booking.id,
        event: 'booking_no_show',
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'BOOKING_NO_SHOW_CONFLICT') {
      return conflict('Only confirmed booking can be marked as no-show.');
    }
    throw error;
  }

  return jsonResult({ ok: true });
};

/**
 * staff が確定予約の出席・欠席状態を記録します。
 */
export const markBookingAttendance = async (
  ctx: BookingRouteContext,
  body: BookingAttendanceBody,
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

  if (isRequestedStoreMismatch(body.storeId, booking.storeId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageBookingsScope({
    organizationId: booking.organizationId,
    storeId: booking.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const nextBookingStatus =
    body.attendanceStatus === BOOKING_ATTENDANCE_STATUS.CHECKED_IN
      ? BOOKING_STATUS.COMPLETED
      : BOOKING_STATUS.CONFIRMED;
  if (
    !isBookingStatus(booking.status) ||
    (booking.status !== nextBookingStatus &&
      !canTransitionBookingStatus(booking.status, nextBookingStatus))
  ) {
    return conflict('Only active booking can be marked attendance.');
  }

  const updated = await markConfirmedBookingAttendance({
    database: ctx.database,
    bookingId: booking.id,
    attendanceStatus: body.attendanceStatus,
    actorUserId: identity.userId,
  });
  if (!updated) {
    return conflict('Only active booking can be marked attendance.');
  }

  if (body.attendanceStatus === BOOKING_ATTENDANCE_STATUS.CHECKED_IN) {
    await writeBookingAuditLog({
      database: ctx.database,
      bookingId: booking.id,
      organizationId: booking.organizationId,
      storeId: booking.storeId,
      actorUserId: identity.userId,
      action: BOOKING_AUDIT_ACTION.CHECKED_IN,
      metadata: {
        attendanceStatus: body.attendanceStatus,
      },
      headers,
    });
  }

  return jsonResult({ ok: true });
};
