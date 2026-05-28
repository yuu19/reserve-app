import { findParticipantByUserAndOrganization } from '../../domain/booking/authorization.js';
import { writeBookingAuditLog } from '../../domain/booking/audit.js';
import { BOOKING_STATUS, SLOT_STATUS } from '../../domain/booking/constants.js';
import { isRequestedClassroomMismatch } from '../../shared/classroom-policy.js';
import { serializeBooking } from '../../shared/serializers.js';
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
  consumeBookingTicketLedger,
  findServiceForBookingCreate,
  findSlotForBookingCreate,
  getBookingById,
  insertBooking,
  releaseSlotCapacity,
  reserveSlotCapacityForBookingCreate,
} from './booking.repository.js';
import { notifyBookingEmailBestEffort } from './booking.notifications.js';
import type { BookingCreateBody } from './booking.schemas.js';
import {
  consumeTicketPackForParticipant,
  restoreConsumedTicketPackBalance,
} from '../tickets/ticket.state.js';
import { isUniqueConstraintError, resolveBookingPolicy } from './booking-usecase-helpers.js';

/**
 * participant の予約申込を処理し、即時予約では定員・回数券・監査ログ・通知まで反映します。
 *
 * @remarks
 * 承認制 service は定員や回数券をまだ消費せず、pending approval の申込として保存します。
 */
export const createBooking = async (
  ctx: BookingRouteContext,
  body: BookingCreateBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const participantsCount = body.participantsCount ?? 1;
  const slot = await findSlotForBookingCreate(ctx.database, body.slotId);
  if (!slot) {
    return notFound('Slot not found.');
  }

  if (isRequestedClassroomMismatch(body.classroomId, slot.classroomId)) {
    return forbidden();
  }

  const participant = await findParticipantByUserAndOrganization({
    database: ctx.database,
    organizationId: slot.organizationId,
    classroomId: body.classroomId ?? slot.classroomId,
    userId: identity.userId,
  });
  if (!participant) {
    return forbidden();
  }

  const service = await findServiceForBookingCreate(ctx.database, slot.serviceId);
  if (!service) {
    return notFound('Service not found.');
  }

  const now = new Date();
  if (
    slot.status !== SLOT_STATUS.OPEN ||
    now.getTime() < new Date(slot.bookingOpenAt).getTime() ||
    now.getTime() > new Date(slot.bookingCloseAt).getTime()
  ) {
    return conflict('Slot is not bookable.');
  }

  const bookingPolicy = resolveBookingPolicy(service.bookingPolicy);
  if (bookingPolicy === 'approval') {
    try {
      const bookingId = crypto.randomUUID();
      await insertBooking({
        database: ctx.database,
        bookingId,
        organizationId: slot.organizationId,
        classroomId: slot.classroomId,
        slotId: slot.id,
        serviceId: slot.serviceId,
        participantId: participant.id,
        participantsCount,
        status: BOOKING_STATUS.PENDING_APPROVAL,
        ticketPackId: null,
      });

      await writeBookingAuditLog({
        database: ctx.database,
        bookingId,
        organizationId: slot.organizationId,
        classroomId: slot.classroomId,
        actorUserId: identity.userId,
        action: 'booking.application_received',
        metadata: {
          participantsCount,
        },
        headers,
      });

      const booking = await getBookingById(ctx.database, bookingId);

      await notifyBookingEmailBestEffort({
        database: ctx.database,
        env: ctx.env,
        bookingId,
        event: 'booking_application_received',
      });

      return jsonResult(serializeBooking(booking as Record<string, unknown> | undefined));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return conflict('Duplicate booking is not allowed.');
      }
      throw error;
    }
  }

  let capacityReserved = false;
  let consumedTicketPackId: string | null = null;
  let bookingCreated = false;

  const releaseReservedCapacity = async () => {
    if (!capacityReserved) {
      return;
    }
    await releaseSlotCapacity({
      database: ctx.database,
      slotId: slot.id,
      participantsCount,
    });
    capacityReserved = false;
  };

  const restoreTicket = async () => {
    if (consumedTicketPackId) {
      await restoreConsumedTicketPackBalance({
        database: ctx.database,
        ticketPackId: consumedTicketPackId,
        participantsCount,
      });
    }
    consumedTicketPackId = null;
  };

  try {
    const reserved = await reserveSlotCapacityForBookingCreate({
      database: ctx.database,
      slotId: slot.id,
      participantsCount,
      now,
    });
    if (!reserved) {
      throw new Error('CAPACITY_OR_TIME_CONFLICT');
    }
    capacityReserved = true;

    let consumedBalanceAfter: number | null = null;
    if (service.requiresTicket) {
      const consumed = await consumeTicketPackForParticipant({
        database: ctx.database,
        organizationId: slot.organizationId,
        classroomId: slot.classroomId,
        serviceId: slot.serviceId,
        participantId: participant.id,
        participantsCount,
        now,
      });
      consumedTicketPackId = consumed.ticketPackId;
      consumedBalanceAfter = consumed.balanceAfter;
    }

    const bookingId = crypto.randomUUID();
    await insertBooking({
      database: ctx.database,
      bookingId,
      organizationId: slot.organizationId,
      classroomId: slot.classroomId,
      slotId: slot.id,
      serviceId: slot.serviceId,
      participantId: participant.id,
      participantsCount,
      status: BOOKING_STATUS.CONFIRMED,
      ticketPackId: consumedTicketPackId,
    });
    bookingCreated = true;

    if (consumedTicketPackId) {
      await consumeBookingTicketLedger({
        database: ctx.database,
        organizationId: slot.organizationId,
        classroomId: slot.classroomId,
        ticketPackId: consumedTicketPackId,
        bookingId,
        participantsCount,
        balanceAfter: consumedBalanceAfter ?? 0,
        actorUserId: identity.userId,
        reason: 'booking-created',
      });
    }

    await writeBookingAuditLog({
      database: ctx.database,
      bookingId,
      organizationId: slot.organizationId,
      classroomId: slot.classroomId,
      actorUserId: identity.userId,
      action: 'booking.created',
      metadata: {
        participantsCount,
      },
      headers,
    });

    const booking = await getBookingById(ctx.database, bookingId);

    await notifyBookingEmailBestEffort({
      database: ctx.database,
      env: ctx.env,
      bookingId,
      event: 'booking_confirmed',
    });

    return jsonResult(serializeBooking(booking as Record<string, unknown> | undefined));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      if (!bookingCreated) {
        await restoreTicket();
        await releaseReservedCapacity();
      }
      return conflict('Duplicate booking is not allowed.');
    }
    if (error instanceof Error && error.message === 'CAPACITY_OR_TIME_CONFLICT') {
      return conflict('Slot is full or not bookable.');
    }
    if (
      error instanceof Error &&
      (error.message === 'TICKET_REQUIRED' || error.message === 'TICKET_CONFLICT')
    ) {
      await restoreTicket();
      await releaseReservedCapacity();
      return conflict('No available ticket pack for booking.');
    }
    if (!bookingCreated) {
      await restoreTicket();
      await releaseReservedCapacity();
    }
    throw error;
  }
};
