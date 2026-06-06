import { writeBookingAuditLog } from '../../domain/booking/audit.js';
import {
  BOOKING_AUDIT_ACTION,
  BOOKING_STATUS,
  SLOT_STATUS,
} from '../../domain/booking/constants.js';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { runDatabaseTransactionOrThrow } from '../../infra/db/transaction.js';
import { isBookingStatus } from '../../domain/booking/state.js';
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
  cancelPendingBookingReminderOutboxes,
  enqueueBookingCustomerNotificationOutbox,
  enqueueBookingOperationalNotificationOutbox,
  enqueueBookingRemindersForBooking,
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

  if (!isBookingStatus(booking.status) || booking.status !== BOOKING_STATUS.CONFIRMED) {
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

  try {
    await runDatabaseTransactionOrThrow(ctx.database, async (tx: AuthRuntimeDatabase) => {
      const reserved = await reserveSlotCapacityForReschedule({
        database: tx,
        slotId: targetSlot.id,
        participantsCount: booking.participantsCount,
        now,
      });
      if (!reserved) {
        throw new Error('TARGET_SLOT_CONFLICT');
      }

      const updated = await updateConfirmedBookingSlot({
        database: tx,
        bookingId: booking.id,
        currentSlotId: booking.slotId,
        targetSlotId: targetSlot.id,
      });
      if (!updated) {
        throw new Error('BOOKING_STATE_CONFLICT');
      }

      await releaseConfirmedBookingSlotCapacity({
        database: tx,
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
        database: tx,
        bookingId: booking.id,
        organizationId: booking.organizationId,
        storeId: booking.storeId,
        beforeJson,
        afterJson,
        reason,
        changedByUserId: identity.userId,
      });

      await writeBookingAuditLog({
        database: tx,
        bookingId: booking.id,
        organizationId: booking.organizationId,
        storeId: booking.storeId,
        actorUserId: identity.userId,
        action: BOOKING_AUDIT_ACTION.RESCHEDULED,
        metadata: {
          fromSlotId: booking.slotId,
          toSlotId: targetSlot.id,
          reason,
          changeLogId,
        },
        headers,
      });

      await cancelPendingBookingReminderOutboxes({
        database: tx,
        bookingId: booking.id,
        includeProcessing: true,
        now,
      });

      await Promise.all([
        enqueueBookingCustomerNotificationOutbox({
          database: tx,
          bookingId: booking.id,
          event: 'booking_rescheduled',
          reason,
          dedupeKeyExtra: changeLogId,
        }),
        enqueueBookingOperationalNotificationOutbox({
          database: tx,
          bookingId: booking.id,
          event: 'booking_rescheduled',
          reason,
          dedupeKeyExtra: changeLogId,
        }),
        enqueueBookingRemindersForBooking({
          database: tx,
          bookingId: booking.id,
          now,
        }),
      ]);
    });

    return jsonResult({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'TARGET_SLOT_CONFLICT') {
      return conflict('Target slot is full or not bookable.');
    }
    if (error instanceof Error && error.message === 'BOOKING_STATE_CONFLICT') {
      return conflict('Only confirmed booking can be rescheduled.');
    }
    throw error;
  }
};
