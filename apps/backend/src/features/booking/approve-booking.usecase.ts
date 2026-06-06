import { writeBookingAuditLog } from '../../domain/booking/audit.js';
import { BOOKING_AUDIT_ACTION, BOOKING_STATUS } from '../../domain/booking/constants.js';
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
import { RESERVE_APP_ENTITLEMENTS } from '../billing/policies/reserve-app-billing-policy.js';
import {
  approvePendingBooking,
  consumeBookingTicketLedger,
  findBookingScope,
  findServiceForBookingCreate,
  rejectPendingBooking,
  reserveSlotCapacityForApproval,
} from './booking.repository.js';
import {
  enqueueBookingCustomerNotificationOutbox,
  enqueueBookingRemindersForBooking,
} from './booking.notifications.js';
import type { BookingActionBody, BookingApproveBody } from './booking.schemas.js';
import { consumeTicketPackForParticipant } from '../tickets/ticket.state.js';

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
    booking.status !== BOOKING_STATUS.PENDING_APPROVAL ||
    !canTransitionBookingStatus(booking.status, BOOKING_STATUS.CONFIRMED)
  ) {
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
  try {
    await runDatabaseTransactionOrThrow(ctx.database, async (tx: AuthRuntimeDatabase) => {
      const reserved = await reserveSlotCapacityForApproval({
        database: tx,
        slotId: booking.slotId,
        participantsCount: booking.participantsCount,
      });
      if (!reserved) {
        throw new Error('CAPACITY_OR_SLOT_CONFLICT');
      }

      let consumedTicketPackId: string | null = null;
      let consumedBalanceAfter: number | null = null;
      if (service.requiresTicket) {
        const consumed = await consumeTicketPackForParticipant({
          database: tx,
          organizationId: booking.organizationId,
          storeId: booking.storeId,
          serviceId: booking.serviceId,
          participantId: booking.participantId,
          participantsCount: booking.participantsCount,
          now,
        });
        consumedTicketPackId = consumed.ticketPackId;
        consumedBalanceAfter = consumed.balanceAfter;
      }

      const updated = await approvePendingBooking({
        database: tx,
        bookingId: booking.id,
        ticketPackId: consumedTicketPackId,
      });
      if (!updated) {
        throw new Error('BOOKING_STATE_CONFLICT');
      }

      if (consumedTicketPackId) {
        await consumeBookingTicketLedger({
          database: tx,
          organizationId: booking.organizationId,
          storeId: booking.storeId,
          ticketPackId: consumedTicketPackId,
          bookingId: booking.id,
          participantsCount: booking.participantsCount,
          balanceAfter: consumedBalanceAfter ?? 0,
          actorUserId: identity.userId,
          reason: 'booking-approved',
        });
      }

      await writeBookingAuditLog({
        database: tx,
        bookingId: booking.id,
        organizationId: booking.organizationId,
        storeId: booking.storeId,
        actorUserId: identity.userId,
        action: BOOKING_AUDIT_ACTION.APPROVED,
        metadata: {
          ticketPackId: consumedTicketPackId,
        },
        headers,
      });

      await Promise.all([
        enqueueBookingCustomerNotificationOutbox({
          database: tx,
          bookingId: booking.id,
          event: 'booking_approved',
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
    if (error instanceof Error && error.message === 'CAPACITY_OR_SLOT_CONFLICT') {
      return conflict('Slot is full or not bookable.');
    }
    if (
      error instanceof Error &&
      (error.message === 'TICKET_REQUIRED' || error.message === 'TICKET_CONFLICT')
    ) {
      return conflict('No available ticket pack for booking.');
    }
    if (error instanceof Error && error.message === 'BOOKING_STATE_CONFLICT') {
      return conflict('Only pending approval booking can be approved.');
    }
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
    booking.status !== BOOKING_STATUS.PENDING_APPROVAL ||
    !canTransitionBookingStatus(booking.status, BOOKING_STATUS.REJECTED)
  ) {
    return conflict('Only pending approval booking can be rejected.');
  }

  const premiumGate = await ctx.requireOrganizationEntitlement({
    organizationId: booking.organizationId,
    key: RESERVE_APP_ENTITLEMENTS.BOOKING_APPROVAL,
  });
  if (!premiumGate.allowed) {
    return jsonResult(premiumGate.body, premiumGate.status);
  }

  try {
    await runDatabaseTransactionOrThrow(ctx.database, async (tx: AuthRuntimeDatabase) => {
      const updated = await rejectPendingBooking({
        database: tx,
        bookingId: booking.id,
        reason: body.reason,
        actorUserId: identity.userId,
      });
      if (!updated) {
        throw new Error('BOOKING_REJECT_CONFLICT');
      }

      await writeBookingAuditLog({
        database: tx,
        bookingId: booking.id,
        organizationId: booking.organizationId,
        storeId: booking.storeId,
        actorUserId: identity.userId,
        action: BOOKING_AUDIT_ACTION.REJECTED,
        metadata: {
          reason: body.reason ?? null,
        },
        headers,
      });

      await enqueueBookingCustomerNotificationOutbox({
        database: tx,
        bookingId: booking.id,
        event: 'booking_rejected',
        reason: body.reason ?? null,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'BOOKING_REJECT_CONFLICT') {
      return conflict('Only pending approval booking can be rejected.');
    }
    throw error;
  }

  return jsonResult({ ok: true });
};
