import { and, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import {
  resolveOrganizationStoreContext,
  type OrganizationStoreContext,
} from '../../domain/booking/authorization.js';
import { writeBookingAuditLog } from '../../domain/booking/audit.js';
import {
  BOOKING_AUDIT_ACTION,
  BOOKING_STATUS,
  SLOT_STATUS,
} from '../../domain/booking/constants.js';
import * as dbSchema from '../../infra/db/schema.js';
import { runDatabaseTransaction } from '../../infra/db/transaction.js';
import { serializeBooking } from '../../shared/serializers.js';
import {
  conflict,
  forbidden,
  jsonResult,
  notFound,
  unauthorized,
  validationError,
  type JsonRouteResult,
} from '../../shared/route-result.js';
import { consumeTicketPackForParticipant } from '../tickets/ticket.state.js';
import type { BookingRouteContext } from './booking-route-context.js';
import {
  consumeBookingTicketLedger,
  findServiceForBookingCreate,
  findSlotForBookingCreate,
  getBookingById,
  insertBooking,
  insertBookingCompanions,
  reserveSlotCapacityForBookingCreate,
} from './booking.repository.js';
import { notifyBookingEmailBestEffort } from './booking.notifications.js';
import type { StaffCreateBookingBody, StaffCreateBookingParams } from './booking.schemas.js';
import { isUniqueConstraintError } from './booking-usecase-helpers.js';
import {
  insertFormSubmissions,
  resolveRequiredForms,
  validateFormSubmissions,
} from '../forms/form.logic.js';

const normalizeOptionalText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const findParticipantForStaffCreate = async ({
  ctx,
  context,
  participantId,
}: {
  ctx: BookingRouteContext;
  context: OrganizationStoreContext;
  participantId: string;
}) => {
  const rows = await ctx.database
    .select({
      id: dbSchema.participant.id,
      userId: dbSchema.participant.userId,
      name: dbSchema.participant.name,
      email: dbSchema.participant.email,
    })
    .from(dbSchema.participant)
    .where(
      and(
        eq(dbSchema.participant.id, participantId),
        eq(dbSchema.participant.organizationId, context.organizationId),
        eq(dbSchema.participant.storeId, context.storeId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

/**
 * staff が電話・LINE・店頭などで受けた予約を確定予約として代理作成します。
 */
export const createBookingByStaff = async (
  ctx: BookingRouteContext,
  params: StaffCreateBookingParams,
  body: StaffCreateBookingBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const context = await resolveOrganizationStoreContext({
    database: ctx.database,
    organizationSlug: params.orgSlug,
    storeSlug: params.storeSlug,
  });
  if (!context) {
    return notFound('Organization or store not found.');
  }

  const hasAccess = await ctx.canManageBookingsScope({
    organizationId: context.organizationId,
    storeId: context.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const slot = await findSlotForBookingCreate(ctx.database, body.slotId);
  if (!slot || slot.organizationId !== context.organizationId || slot.storeId !== context.storeId) {
    return notFound('Slot not found.');
  }
  if (slot.status !== SLOT_STATUS.OPEN) {
    return conflict('Slot is not bookable.');
  }

  const service = await findServiceForBookingCreate(ctx.database, slot.serviceId);
  if (!service || !service.isActive) {
    return notFound('Service not found.');
  }

  const participant = body.participantId
    ? await findParticipantForStaffCreate({
        ctx,
        context,
        participantId: body.participantId,
      })
    : null;
  if (body.participantId && !participant) {
    return notFound('Participant not found.');
  }

  const customerName = normalizeOptionalText(body.customerName) ?? participant?.name ?? null;
  const customerEmail =
    normalizeOptionalText(body.customerEmail)?.toLowerCase() ?? participant?.email ?? null;
  if (!customerName || !customerEmail) {
    return validationError('customerName and customerEmail are required without participantId.');
  }
  if (service.requiresTicket && !participant) {
    return conflict('Ticket-required services require an existing participant.');
  }

  const now = new Date();
  const requiredForms = await resolveRequiredForms({
    database: ctx.database,
    organizationId: context.organizationId,
    storeId: context.storeId,
    serviceId: slot.serviceId,
    slotId: slot.id,
  });
  const formValidation = validateFormSubmissions({
    forms: requiredForms.forms,
    submissions: body.formSubmissions,
    requireAllForms: false,
  });
  if (!formValidation.ok) {
    return formValidation.status === 409
      ? conflict(formValidation.message)
      : validationError(formValidation.message);
  }

  const bookingId = crypto.randomUUID();
  try {
    await runDatabaseTransaction(ctx.database, async (tx: AuthRuntimeDatabase) => {
      const reserved = await reserveSlotCapacityForBookingCreate({
        database: tx,
        slotId: slot.id,
        participantsCount: body.participantsCount,
        now,
      });
      if (!reserved) {
        throw new Error('CAPACITY_OR_TIME_CONFLICT');
      }

      let consumedTicketPackId: string | null = null;
      let consumedBalanceAfter: number | null = null;
      if (service.requiresTicket && participant) {
        const consumed = await consumeTicketPackForParticipant({
          database: tx,
          organizationId: context.organizationId,
          storeId: context.storeId,
          serviceId: slot.serviceId,
          participantId: participant.id,
          participantsCount: body.participantsCount,
          now,
        });
        consumedTicketPackId = consumed.ticketPackId;
        consumedBalanceAfter = consumed.balanceAfter;
      }

      await insertBooking({
        database: tx,
        bookingId,
        organizationId: context.organizationId,
        storeId: context.storeId,
        slotId: slot.id,
        serviceId: slot.serviceId,
        participantId: participant?.id ?? null,
        source: body.source,
        participantsCount: body.participantsCount,
        customerName,
        customerEmail,
        customerPhone: normalizeOptionalText(body.customerPhone),
        note: normalizeOptionalText(body.note),
        createdByUserId: identity.userId,
        status: BOOKING_STATUS.CONFIRMED,
        ticketPackId: consumedTicketPackId,
      });

      await insertBookingCompanions({
        database: tx,
        bookingId,
        companions: body.companions ?? [],
      });

      await insertFormSubmissions({
        database: tx,
        organizationId: context.organizationId,
        storeId: context.storeId,
        bookingId,
        participantId: participant?.id ?? null,
        customerName,
        customerEmail,
        source: 'staff',
        submittedByUserId: identity.userId,
        submittedAt: now,
        submissions: formValidation.submissions,
      });

      if (consumedTicketPackId) {
        await consumeBookingTicketLedger({
          database: tx,
          organizationId: context.organizationId,
          storeId: context.storeId,
          ticketPackId: consumedTicketPackId,
          bookingId,
          participantsCount: body.participantsCount,
          balanceAfter: consumedBalanceAfter ?? 0,
          actorUserId: identity.userId,
          reason: 'booking-created-by-staff',
        });
      }

      await writeBookingAuditLog({
        database: tx,
        bookingId,
        organizationId: context.organizationId,
        storeId: context.storeId,
        actorUserId: identity.userId,
        action: BOOKING_AUDIT_ACTION.CREATED,
        metadata: {
          initialStatus: BOOKING_STATUS.CONFIRMED,
          participantsCount: body.participantsCount,
          source: body.source,
          notifyCustomer: body.notifyCustomer,
        },
        headers,
      });
    });

    if (body.notifyCustomer) {
      await notifyBookingEmailBestEffort({
        database: ctx.database,
        env: ctx.env,
        bookingId,
        event: 'booking_confirmed',
      });
    }

    const booking = await getBookingById(ctx.database, bookingId);
    return jsonResult(serializeBooking(booking as Record<string, unknown> | undefined));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return conflict('Duplicate booking is not allowed.');
    }
    if (error instanceof Error && error.message === 'CAPACITY_OR_TIME_CONFLICT') {
      return conflict('Slot is full or not bookable.');
    }
    if (
      error instanceof Error &&
      (error.message === 'TICKET_REQUIRED' || error.message === 'TICKET_CONFLICT')
    ) {
      return conflict('No available ticket pack for booking.');
    }
    throw error;
  }
};
