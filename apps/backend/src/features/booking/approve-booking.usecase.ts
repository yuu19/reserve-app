import { writeBookingAuditLog } from '../../domain/booking/audit.js';
import { BOOKING_STATUS } from '../../domain/booking/constants.js';
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
import { RESERVE_APP_ENTITLEMENTS } from '../billing/policies/reserve-app-billing-policy.js';
import {
  approvePendingBooking,
  consumeBookingTicketLedger,
  findBookingScope,
  findServiceForBookingCreate,
  rejectPendingBooking,
  releaseSlotCapacity,
  reserveSlotCapacityForApproval,
} from './booking.repository.js';
import { notifyBookingEmailBestEffort } from './booking.notifications.js';
import type { BookingActionBody, BookingApproveBody } from './booking.schemas.js';
import {
  consumeTicketPackForParticipant,
  restoreConsumedTicketPackBalance,
} from '../tickets/ticket.state.js';

/**
 * staff が承認待ち予約を承認し、定員確保と必要な ticket pack 消費を同時に処理します。
 *
 * @remarks
 * 定員確保後に ticket 消費や状態更新が失敗した場合は、補償処理で定員と ticket を戻します。
 */
export const approveBookingByStaff = async (
  ctx: BookingRouteContext,
  body: BookingApproveBody,
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

  if (booking.status !== BOOKING_STATUS.PENDING_APPROVAL) {
    return conflict('Only pending approval booking can be approved.');
  }

  const premiumGate = await ctx.requireOrganizationEntitlement({
    organizationId: booking.organizationId,
    key: RESERVE_APP_ENTITLEMENTS.BOOKING_APPROVAL,
  });
  if (!premiumGate.allowed) {
    return jsonResult(premiumGate.body, premiumGate.status);
  }

  const service = await findServiceForBookingCreate(ctx.database, booking.serviceId);
  if (!service) {
    return notFound('Service not found.');
  }

  const now = new Date();
  let capacityReserved = false;
  let consumedTicketPackId: string | null = null;
  let consumedBalanceAfter: number | null = null;

  const releaseReservedCapacity = async () => {
    if (!capacityReserved) {
      return;
    }
    await releaseSlotCapacity({
      database: ctx.database,
      slotId: booking.slotId,
      participantsCount: booking.participantsCount,
    });
    capacityReserved = false;
  };

  const restoreTicket = async () => {
    if (consumedTicketPackId) {
      await restoreConsumedTicketPackBalance({
        database: ctx.database,
        ticketPackId: consumedTicketPackId,
        participantsCount: booking.participantsCount,
      });
    }
    consumedTicketPackId = null;
    consumedBalanceAfter = null;
  };

  try {
    const reserved = await reserveSlotCapacityForApproval({
      database: ctx.database,
      slotId: booking.slotId,
      participantsCount: booking.participantsCount,
    });
    if (!reserved) {
      throw new Error('CAPACITY_OR_SLOT_CONFLICT');
    }
    capacityReserved = true;

    if (service.requiresTicket) {
      const consumed = await consumeTicketPackForParticipant({
        database: ctx.database,
        organizationId: booking.organizationId,
        classroomId: booking.classroomId,
        participantId: booking.participantId,
        participantsCount: booking.participantsCount,
        now,
      });
      consumedTicketPackId = consumed.ticketPackId;
      consumedBalanceAfter = consumed.balanceAfter;
    }

    const updated = await approvePendingBooking({
      database: ctx.database,
      bookingId: booking.id,
      ticketPackId: consumedTicketPackId,
    });
    if (!updated) {
      throw new Error('BOOKING_STATE_CONFLICT');
    }

    if (consumedTicketPackId) {
      await consumeBookingTicketLedger({
        database: ctx.database,
        organizationId: booking.organizationId,
        classroomId: booking.classroomId,
        ticketPackId: consumedTicketPackId,
        bookingId: booking.id,
        participantsCount: booking.participantsCount,
        balanceAfter: consumedBalanceAfter ?? 0,
        actorUserId: identity.userId,
        reason: 'booking-approved',
      });
    }

    await writeBookingAuditLog({
      database: ctx.database,
      bookingId: booking.id,
      organizationId: booking.organizationId,
      classroomId: booking.classroomId,
      actorUserId: identity.userId,
      action: 'booking.approved',
      metadata: {
        ticketPackId: consumedTicketPackId,
      },
      headers,
    });

    await notifyBookingEmailBestEffort({
      database: ctx.database,
      env: ctx.env,
      bookingId: booking.id,
      event: 'booking_approved',
    });

    return jsonResult({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'CAPACITY_OR_SLOT_CONFLICT') {
      return conflict('Slot is full or not bookable.');
    }
    if (
      error instanceof Error &&
      (error.message === 'TICKET_REQUIRED' || error.message === 'TICKET_CONFLICT')
    ) {
      await releaseReservedCapacity();
      await restoreTicket();
      return conflict('No available ticket pack for booking.');
    }
    if (error instanceof Error && error.message === 'BOOKING_STATE_CONFLICT') {
      await releaseReservedCapacity();
      await restoreTicket();
      return conflict('Only pending approval booking can be approved.');
    }
    await releaseReservedCapacity();
    await restoreTicket();
    throw error;
  }
};

/**
 * staff が承認待ち予約を却下し、監査ログと通知を残します。
 */
export const rejectBookingByStaff = async (
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

  if (booking.status !== BOOKING_STATUS.PENDING_APPROVAL) {
    return conflict('Only pending approval booking can be rejected.');
  }

  const premiumGate = await ctx.requireOrganizationEntitlement({
    organizationId: booking.organizationId,
    key: RESERVE_APP_ENTITLEMENTS.BOOKING_APPROVAL,
  });
  if (!premiumGate.allowed) {
    return jsonResult(premiumGate.body, premiumGate.status);
  }

  const updated = await rejectPendingBooking({
    database: ctx.database,
    bookingId: booking.id,
    reason: body.reason,
    actorUserId: identity.userId,
  });
  if (!updated) {
    return conflict('Only pending approval booking can be rejected.');
  }

  await writeBookingAuditLog({
    database: ctx.database,
    bookingId: booking.id,
    organizationId: booking.organizationId,
    classroomId: booking.classroomId,
    actorUserId: identity.userId,
    action: 'booking.rejected_by_staff',
    metadata: {
      reason: body.reason ?? null,
    },
    headers,
  });

  await notifyBookingEmailBestEffort({
    database: ctx.database,
    env: ctx.env,
    bookingId: booking.id,
    event: 'booking_rejected',
    reason: body.reason ?? null,
  });

  return jsonResult({ ok: true });
};
