import {
  findParticipantByUserAndOrganization,
  resolveOrganizationId,
} from '../../booking/authorization.js';
import { writeBookingAuditLog } from '../../booking/audit.js';
import {
  BOOKING_STATUS,
  DEFAULT_CANCELLATION_DEADLINE_MINUTES,
  SLOT_STATUS,
} from '../../booking/constants.js';
import { isRequestedClassroomMismatch } from '../shared/classroom-policy.js';
import { parseIsoDateOrNull } from '../shared/date.js';
import { serializeBooking } from '../shared/serializers.js';
import {
  conflict,
  forbidden,
  jsonResult,
  notFound,
  unauthorized,
  validationError,
  type JsonRouteResult,
} from '../shared/route-result.js';
import type { BookingRouteContext } from '../shared/route-context.js';
import {
  approvePendingBooking,
  cancelBookingByParticipantState,
  cancelBookingByStaffState,
  consumeBookingTicketLedger,
  findBookingForParticipantCancel,
  findBookingScope,
  findServiceCancellationPolicy,
  findServiceForBookingCreate,
  findSlotForBookingCreate,
  findSlotStart,
  getBookingById,
  insertBooking,
  listBookings,
  markConfirmedBookingNoShow,
  rejectPendingBooking,
  releaseConfirmedBookingSlotCapacity,
  releaseSlotCapacity,
  reserveSlotCapacityForApproval,
  reserveSlotCapacityForBookingCreate,
  restoreTicketPackForBookingCancel,
} from './booking.repository.js';
import { notifyBookingEmailBestEffort } from './booking.notifications.js';
import type {
  BookingActionBody,
  BookingApproveBody,
  BookingCreateBody,
  BookingListQuery,
  BookingMineQuery,
  BookingNoShowBody,
} from './booking.schemas.js';
import { consumeTicketPackForParticipant, normalizePackStatus } from '../tickets/ticket.state.js';
import * as dbSchema from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';

const isUniqueConstraintError = (error: unknown): boolean => {
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!(current instanceof Error)) {
      continue;
    }
    if (
      current.message.includes('UNIQUE constraint failed') ||
      current.message.includes('SQLITE_CONSTRAINT')
    ) {
      return true;
    }
    const nestedCause = (current as Error & { cause?: unknown }).cause;
    if (nestedCause) {
      queue.push(nestedCause);
    }
  }
  return false;
};

const resolveBookingPolicy = (value: string | null | undefined): 'instant' | 'approval' => {
  return value === 'approval' ? 'approval' : 'instant';
};

const restoreConsumedTicket = async ({
  ctx,
  consumedTicketPackId,
  participantsCount,
}: {
  ctx: BookingRouteContext;
  consumedTicketPackId: string | null;
  participantsCount: number;
}) => {
  if (!consumedTicketPackId) {
    return;
  }
  const restoredRows = await ctx.database
    .update(dbSchema.ticketPack)
    .set({
      remainingCount: sql`${dbSchema.ticketPack.remainingCount} + ${participantsCount}`,
    })
    .where(eq(dbSchema.ticketPack.id, consumedTicketPackId))
    .returning({
      id: dbSchema.ticketPack.id,
      remainingCount: dbSchema.ticketPack.remainingCount,
      expiresAt: dbSchema.ticketPack.expiresAt,
    });
  const restoredPack = restoredRows[0];
  if (restoredPack) {
    const packStatus = normalizePackStatus({
      remainingCount: restoredPack.remainingCount,
      expiresAt: restoredPack.expiresAt,
    });
    await ctx.database
      .update(dbSchema.ticketPack)
      .set({
        status: packStatus,
      })
      .where(eq(dbSchema.ticketPack.id, restoredPack.id));
  }
};

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
    await restoreConsumedTicket({
      ctx,
      consumedTicketPackId,
      participantsCount,
    });
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

/**
 * participant 自身が参照できる予約だけを一覧します。
 */
export const listMyBookings = async (
  ctx: BookingRouteContext,
  query: BookingMineQuery,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
  if (!organizationId) {
    return validationError('organizationId is required.');
  }

  const participantRecords = await ctx.listParticipantRecordsForUser({
    organizationId,
    classroomId: query.classroomId,
    userId: identity.userId,
  });
  if (participantRecords.length === 0) {
    return forbidden();
  }
  const participantIds = participantRecords.map((participant) => participant.id);

  const rows = await listBookings({
    database: ctx.database,
    organizationId,
    classroomId: query.classroomId,
    participantIds,
    status: query.status,
    from: parseIsoDateOrNull(query.from),
    to: parseIsoDateOrNull(query.to),
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeBooking(row)));
};

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
 * staff が管理権限を持つ予約を条件付きで一覧します。
 */
export const listStaffBookings = async (
  ctx: BookingRouteContext,
  query: BookingListQuery,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
  if (!organizationId) {
    return validationError('organizationId is required.');
  }

  const hasAccess = await ctx.canManageBookingsScope({
    organizationId,
    classroomId: query.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const rows = await listBookings({
    database: ctx.database,
    organizationId,
    classroomId: query.classroomId,
    serviceId: query.serviceId,
    participantId: query.participantId,
    status: query.status,
    from: parseIsoDateOrNull(query.from),
    to: parseIsoDateOrNull(query.to),
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeBooking(row)));
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

  const premiumGate = await ctx.requireOrganizationPremiumFeature(booking.organizationId);
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
    await restoreConsumedTicket({
      ctx,
      consumedTicketPackId,
      participantsCount: booking.participantsCount,
    });
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

  const premiumGate = await ctx.requireOrganizationPremiumFeature(booking.organizationId);
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
