import { writeBookingAuditLog } from '../../domain/booking/audit.js';
import { BOOKING_STATUS, SLOT_STATUS } from '../../domain/booking/constants.js';
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
  findBookingForReschedule,
  findSlotForBookingReschedule,
  insertBookingChangeLog,
  releaseConfirmedBookingSlotCapacity,
  reserveSlotCapacityForReschedule,
  updateConfirmedBookingSlot,
} from './booking.repository.js';
import {
  notifyBookingEmailBestEffort,
  notifyBookingOperationalEmailBestEffort,
} from './booking.notifications.js';
import type { BookingRescheduleBody } from './booking.schemas.js';

const normalizeOptionalText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const toIsoString = (value: Date | string | number): string => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

/**
 * staff が確定予約の予約枠だけを同一サービス内の将来 open 枠へ変更します。
 */
export const rescheduleBookingByStaff = async (
  ctx: BookingRouteContext,
  body: BookingRescheduleBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const booking = await findBookingForReschedule(ctx.database, body.bookingId);
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

  if (booking.status !== BOOKING_STATUS.CONFIRMED) {
    return conflict('Only confirmed booking can be rescheduled.');
  }

  if (booking.slotId === body.targetSlotId) {
    return conflict('Target slot must be different from current slot.');
  }

  const targetSlot = await findSlotForBookingReschedule(ctx.database, body.targetSlotId);
  if (!targetSlot) {
    return notFound('Target slot not found.');
  }

  if (
    targetSlot.organizationId !== booking.organizationId ||
    targetSlot.storeId !== booking.storeId
  ) {
    return forbidden();
  }

  if (targetSlot.serviceId !== booking.serviceId) {
    return conflict('Target slot must be for same service.');
  }

  const now = new Date();
  const targetSlotStartAt =
    targetSlot.startAt instanceof Date ? targetSlot.startAt : new Date(targetSlot.startAt);
  if (targetSlot.status !== SLOT_STATUS.OPEN || targetSlotStartAt.getTime() < now.getTime()) {
    return conflict('Target slot is not bookable.');
  }

  let targetCapacityReserved = false;
  const releaseTargetCapacity = async () => {
    if (!targetCapacityReserved) {
      return;
    }
    await releaseConfirmedBookingSlotCapacity({
      database: ctx.database,
      slotId: targetSlot.id,
      participantsCount: booking.participantsCount,
    });
    targetCapacityReserved = false;
  };

  try {
    const reserved = await reserveSlotCapacityForReschedule({
      database: ctx.database,
      slotId: targetSlot.id,
      participantsCount: booking.participantsCount,
      now,
    });
    if (!reserved) {
      throw new Error('TARGET_SLOT_CONFLICT');
    }
    targetCapacityReserved = true;

    const updated = await updateConfirmedBookingSlot({
      database: ctx.database,
      bookingId: booking.id,
      currentSlotId: booking.slotId,
      targetSlotId: targetSlot.id,
    });
    if (!updated) {
      throw new Error('BOOKING_STATE_CONFLICT');
    }
    targetCapacityReserved = false;

    await releaseConfirmedBookingSlotCapacity({
      database: ctx.database,
      slotId: booking.slotId,
      participantsCount: booking.participantsCount,
    });

    const reason = normalizeOptionalText(body.reason);
    const beforeJson = JSON.stringify({
      slotId: booking.slotId,
      serviceId: booking.serviceId,
      startAt: toIsoString(booking.currentSlotStartAt),
      endAt: toIsoString(booking.currentSlotEndAt),
      participantsCount: booking.participantsCount,
      status: booking.status,
    });
    const afterJson = JSON.stringify({
      slotId: targetSlot.id,
      serviceId: targetSlot.serviceId,
      startAt: toIsoString(targetSlot.startAt),
      endAt: toIsoString(targetSlot.endAt),
      participantsCount: booking.participantsCount,
      status: BOOKING_STATUS.CONFIRMED,
    });

    const changeLogId = await insertBookingChangeLog({
      database: ctx.database,
      bookingId: booking.id,
      organizationId: booking.organizationId,
      storeId: booking.storeId,
      beforeJson,
      afterJson,
      reason,
      changedByUserId: identity.userId,
    });

    await writeBookingAuditLog({
      database: ctx.database,
      bookingId: booking.id,
      organizationId: booking.organizationId,
      storeId: booking.storeId,
      actorUserId: identity.userId,
      action: 'booking.rescheduled',
      metadata: {
        fromSlotId: booking.slotId,
        toSlotId: targetSlot.id,
        reason,
        changeLogId,
      },
      headers,
    });

    await Promise.all([
      notifyBookingEmailBestEffort({
        database: ctx.database,
        env: ctx.env,
        bookingId: booking.id,
        event: 'booking_rescheduled',
        reason,
        dedupeKeyExtra: changeLogId,
      }),
      notifyBookingOperationalEmailBestEffort({
        database: ctx.database,
        env: ctx.env,
        bookingId: booking.id,
        event: 'booking_rescheduled',
        reason,
        dedupeKeyExtra: changeLogId,
      }),
    ]);

    return jsonResult({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'TARGET_SLOT_CONFLICT') {
      return conflict('Target slot is full or not bookable.');
    }
    if (error instanceof Error && error.message === 'BOOKING_STATE_CONFLICT') {
      await releaseTargetCapacity();
      return conflict('Only confirmed booking can be rescheduled.');
    }
    await releaseTargetCapacity();
    throw error;
  }
};
