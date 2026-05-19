import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import {
  BOOKING_STATUS,
  SLOT_STATUS,
  TICKET_LEDGER_ACTION,
  TICKET_PACK_STATUS,
} from '../../booking/constants.js';
import * as dbSchema from '../../db/schema.js';

export const findSlotForBookingCreate = async (database: AuthRuntimeDatabase, slotId: string) => {
  const slotRows = await database
    .select({
      id: dbSchema.slot.id,
      organizationId: dbSchema.slot.organizationId,
      classroomId: dbSchema.slot.classroomId,
      serviceId: dbSchema.slot.serviceId,
      startAt: dbSchema.slot.startAt,
      status: dbSchema.slot.status,
      bookingOpenAt: dbSchema.slot.bookingOpenAt,
      bookingCloseAt: dbSchema.slot.bookingCloseAt,
    })
    .from(dbSchema.slot)
    .where(eq(dbSchema.slot.id, slotId))
    .limit(1);
  return slotRows[0] ?? null;
};

export const findServiceForBookingCreate = async (
  database: AuthRuntimeDatabase,
  serviceId: string,
) => {
  const serviceRows = await database
    .select({
      id: dbSchema.service.id,
      bookingPolicy: dbSchema.service.bookingPolicy,
      requiresTicket: dbSchema.service.requiresTicket,
    })
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, serviceId))
    .limit(1);
  return serviceRows[0] ?? null;
};

export const insertBooking = async ({
  database,
  bookingId,
  organizationId,
  classroomId,
  slotId,
  serviceId,
  participantId,
  participantsCount,
  status,
  ticketPackId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  organizationId: string;
  classroomId: string;
  slotId: string;
  serviceId: string;
  participantId: string;
  participantsCount: number;
  status: string;
  ticketPackId: string | null;
}) => {
  await database.insert(dbSchema.booking).values({
    id: bookingId,
    organizationId,
    classroomId,
    slotId,
    serviceId,
    participantId,
    participantsCount,
    status,
    ticketPackId,
  });
};

export const getBookingById = async (database: AuthRuntimeDatabase, bookingId: string) => {
  const rows = await database
    .select()
    .from(dbSchema.booking)
    .where(eq(dbSchema.booking.id, bookingId))
    .limit(1);
  return rows[0] ?? null;
};

export const reserveSlotCapacityForBookingCreate = async ({
  database,
  slotId,
  participantsCount,
  now,
}: {
  database: AuthRuntimeDatabase;
  slotId: string;
  participantsCount: number;
  now: Date;
}) => {
  const capacityRows = await database
    .update(dbSchema.slot)
    .set({
      reservedCount: sql`${dbSchema.slot.reservedCount} + ${participantsCount}`,
    })
    .where(
      and(
        eq(dbSchema.slot.id, slotId),
        eq(dbSchema.slot.status, SLOT_STATUS.OPEN),
        lte(dbSchema.slot.bookingOpenAt, now),
        gte(dbSchema.slot.bookingCloseAt, now),
        sql`${dbSchema.slot.reservedCount} + ${participantsCount} <= ${dbSchema.slot.capacity}`,
      ),
    )
    .returning({ id: dbSchema.slot.id });
  return capacityRows.length > 0;
};

export const reserveSlotCapacityForApproval = async ({
  database,
  slotId,
  participantsCount,
}: {
  database: AuthRuntimeDatabase;
  slotId: string;
  participantsCount: number;
}) => {
  const capacityRows = await database
    .update(dbSchema.slot)
    .set({
      reservedCount: sql`${dbSchema.slot.reservedCount} + ${participantsCount}`,
    })
    .where(
      and(
        eq(dbSchema.slot.id, slotId),
        eq(dbSchema.slot.status, SLOT_STATUS.OPEN),
        sql`${dbSchema.slot.reservedCount} + ${participantsCount} <= ${dbSchema.slot.capacity}`,
      ),
    )
    .returning({ id: dbSchema.slot.id });
  return capacityRows.length > 0;
};

export const releaseSlotCapacity = async ({
  database,
  slotId,
  participantsCount,
}: {
  database: AuthRuntimeDatabase;
  slotId: string;
  participantsCount: number;
}) => {
  await database
    .update(dbSchema.slot)
    .set({
      reservedCount: sql`case
        when ${dbSchema.slot.reservedCount} >= ${participantsCount}
        then ${dbSchema.slot.reservedCount} - ${participantsCount}
        else 0
      end`,
    })
    .where(eq(dbSchema.slot.id, slotId));
};

export const consumeBookingTicketLedger = async ({
  database,
  organizationId,
  classroomId,
  ticketPackId,
  bookingId,
  participantsCount,
  balanceAfter,
  actorUserId,
  reason,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId: string;
  ticketPackId: string;
  bookingId: string;
  participantsCount: number;
  balanceAfter: number;
  actorUserId: string;
  reason: string;
}) => {
  await database.insert(dbSchema.ticketLedger).values({
    id: crypto.randomUUID(),
    organizationId,
    classroomId,
    ticketPackId,
    bookingId,
    action: TICKET_LEDGER_ACTION.CONSUME,
    delta: participantsCount * -1,
    balanceAfter,
    actorUserId,
    reason,
  });
};

export const findBookingForParticipantCancel = async (
  database: AuthRuntimeDatabase,
  bookingId: string,
) => {
  const bookingRows = await database
    .select({
      id: dbSchema.booking.id,
      organizationId: dbSchema.booking.organizationId,
      classroomId: dbSchema.booking.classroomId,
      participantId: dbSchema.booking.participantId,
      status: dbSchema.booking.status,
      participantsCount: dbSchema.booking.participantsCount,
      ticketPackId: dbSchema.booking.ticketPackId,
      slotId: dbSchema.booking.slotId,
      serviceId: dbSchema.booking.serviceId,
    })
    .from(dbSchema.booking)
    .where(eq(dbSchema.booking.id, bookingId))
    .limit(1);
  return bookingRows[0] ?? null;
};

export const findBookingScope = async (database: AuthRuntimeDatabase, bookingId: string) => {
  const bookingRows = await database
    .select({
      id: dbSchema.booking.id,
      organizationId: dbSchema.booking.organizationId,
      classroomId: dbSchema.booking.classroomId,
      slotId: dbSchema.booking.slotId,
      serviceId: dbSchema.booking.serviceId,
      participantId: dbSchema.booking.participantId,
      participantsCount: dbSchema.booking.participantsCount,
      status: dbSchema.booking.status,
    })
    .from(dbSchema.booking)
    .where(eq(dbSchema.booking.id, bookingId))
    .limit(1);
  return bookingRows[0] ?? null;
};

export const findSlotStart = async (database: AuthRuntimeDatabase, slotId: string) => {
  const slotRows = await database
    .select({
      id: dbSchema.slot.id,
      startAt: dbSchema.slot.startAt,
    })
    .from(dbSchema.slot)
    .where(eq(dbSchema.slot.id, slotId))
    .limit(1);
  return slotRows[0] ?? null;
};

export const findServiceCancellationPolicy = async (
  database: AuthRuntimeDatabase,
  serviceId: string,
) => {
  const serviceRows = await database
    .select({
      cancellationDeadlineMinutes: dbSchema.service.cancellationDeadlineMinutes,
    })
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, serviceId))
    .limit(1);
  return serviceRows[0] ?? null;
};

export const cancelBookingByParticipantState = async ({
  database,
  bookingId,
  reason,
  actorUserId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  reason?: string;
  actorUserId: string;
}) => {
  await database
    .update(dbSchema.booking)
    .set({
      status: BOOKING_STATUS.CANCELED_BY_PARTICIPANT,
      cancelReason: reason ?? null,
      cancelledAt: new Date(),
      cancelledByUserId: actorUserId,
    })
    .where(eq(dbSchema.booking.id, bookingId));
};

export const cancelBookingByStaffState = async ({
  database,
  bookingId,
  reason,
  actorUserId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  reason?: string;
  actorUserId: string;
}) => {
  await database
    .update(dbSchema.booking)
    .set({
      status: BOOKING_STATUS.CANCELED_BY_STAFF,
      cancelReason: reason ?? null,
      cancelledAt: new Date(),
      cancelledByUserId: actorUserId,
    })
    .where(eq(dbSchema.booking.id, bookingId));
};

export const releaseConfirmedBookingSlotCapacity = async ({
  database,
  slotId,
  participantsCount,
}: {
  database: AuthRuntimeDatabase;
  slotId: string;
  participantsCount: number;
}) => {
  await database
    .update(dbSchema.slot)
    .set({
      reservedCount: sql`${dbSchema.slot.reservedCount} - ${participantsCount}`,
    })
    .where(and(eq(dbSchema.slot.id, slotId), gte(dbSchema.slot.reservedCount, participantsCount)));
};

export const restoreTicketPackForBookingCancel = async ({
  database,
  organizationId,
  classroomId,
  ticketPackId,
  bookingId,
  participantsCount,
  actorUserId,
  reason,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId: string;
  ticketPackId: string;
  bookingId: string;
  participantsCount: number;
  actorUserId: string;
  reason: string;
}) => {
  await database
    .update(dbSchema.ticketPack)
    .set({
      remainingCount: sql`${dbSchema.ticketPack.remainingCount} + ${participantsCount}`,
      status: TICKET_PACK_STATUS.ACTIVE,
    })
    .where(eq(dbSchema.ticketPack.id, ticketPackId));

  const packRows = await database
    .select({
      remainingCount: dbSchema.ticketPack.remainingCount,
    })
    .from(dbSchema.ticketPack)
    .where(eq(dbSchema.ticketPack.id, ticketPackId))
    .limit(1);
  const pack = packRows[0];

  await database.insert(dbSchema.ticketLedger).values({
    id: crypto.randomUUID(),
    organizationId,
    classroomId,
    ticketPackId,
    bookingId,
    action: TICKET_LEDGER_ACTION.RESTORE,
    delta: participantsCount,
    balanceAfter: pack?.remainingCount ?? 0,
    actorUserId,
    reason,
  });
};

export const approvePendingBooking = async ({
  database,
  bookingId,
  ticketPackId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  ticketPackId: string | null;
}) => {
  const updatedRows = await database
    .update(dbSchema.booking)
    .set({
      status: BOOKING_STATUS.CONFIRMED,
      ticketPackId,
    })
    .where(
      and(
        eq(dbSchema.booking.id, bookingId),
        eq(dbSchema.booking.status, BOOKING_STATUS.PENDING_APPROVAL),
      ),
    )
    .returning({ id: dbSchema.booking.id });
  return updatedRows.length > 0;
};

export const rejectPendingBooking = async ({
  database,
  bookingId,
  reason,
  actorUserId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  reason?: string;
  actorUserId: string;
}) => {
  const updatedRows = await database
    .update(dbSchema.booking)
    .set({
      status: BOOKING_STATUS.REJECTED_BY_STAFF,
      cancelReason: reason ?? null,
      cancelledAt: new Date(),
      cancelledByUserId: actorUserId,
    })
    .where(
      and(
        eq(dbSchema.booking.id, bookingId),
        eq(dbSchema.booking.status, BOOKING_STATUS.PENDING_APPROVAL),
      ),
    )
    .returning({ id: dbSchema.booking.id });
  return updatedRows.length > 0;
};

export const markConfirmedBookingNoShow = async ({
  database,
  bookingId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
}) => {
  await database
    .update(dbSchema.booking)
    .set({
      status: BOOKING_STATUS.NO_SHOW,
      noShowMarkedAt: new Date(),
    })
    .where(eq(dbSchema.booking.id, bookingId));
};

export const listBookings = async ({
  database,
  organizationId,
  classroomId,
  serviceId,
  participantId,
  participantIds,
  status,
  from,
  to,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string;
  serviceId?: string;
  participantId?: string;
  participantIds?: string[];
  status?: string;
  from?: Date | null;
  to?: Date | null;
}) => {
  const filters = [eq(dbSchema.booking.organizationId, organizationId)];
  if (participantIds) {
    filters.push(inArray(dbSchema.booking.participantId, participantIds));
  }
  if (classroomId) {
    filters.push(eq(dbSchema.booking.classroomId, classroomId));
  }
  if (serviceId) {
    filters.push(eq(dbSchema.booking.serviceId, serviceId));
  }
  if (participantId) {
    filters.push(eq(dbSchema.booking.participantId, participantId));
  }
  if (status) {
    filters.push(eq(dbSchema.booking.status, status));
  }
  if (from) {
    filters.push(gte(dbSchema.booking.createdAt, from));
  }
  if (to) {
    filters.push(lte(dbSchema.booking.createdAt, to));
  }

  return database
    .select()
    .from(dbSchema.booking)
    .where(and(...filters))
    .orderBy(desc(dbSchema.booking.createdAt));
};
