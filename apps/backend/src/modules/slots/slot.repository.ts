import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { BOOKING_STATUS, SLOT_STATUS } from '../../booking/constants.js';
import * as dbSchema from '../../db/schema.js';

export const findServiceForSlot = async (database: AuthRuntimeDatabase, serviceId: string) => {
  const rows = await database
    .select({
      id: dbSchema.service.id,
      organizationId: dbSchema.service.organizationId,
      classroomId: dbSchema.service.classroomId,
      bookingOpenMinutesBefore: dbSchema.service.bookingOpenMinutesBefore,
      bookingCloseMinutesBefore: dbSchema.service.bookingCloseMinutesBefore,
      capacity: dbSchema.service.capacity,
    })
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, serviceId))
    .limit(1);
  return rows[0] ?? null;
};

export const findSlotForUpdate = async (database: AuthRuntimeDatabase, slotId: string) => {
  const rows = await database
    .select({
      id: dbSchema.slot.id,
      organizationId: dbSchema.slot.organizationId,
      classroomId: dbSchema.slot.classroomId,
      serviceId: dbSchema.slot.serviceId,
      status: dbSchema.slot.status,
      reservedCount: dbSchema.slot.reservedCount,
      startAt: dbSchema.slot.startAt,
      capacity: dbSchema.slot.capacity,
    })
    .from(dbSchema.slot)
    .where(eq(dbSchema.slot.id, slotId))
    .limit(1);
  return rows[0] ?? null;
};

export const findSlotForCancel = async (database: AuthRuntimeDatabase, slotId: string) => {
  const rows = await database
    .select({
      id: dbSchema.slot.id,
      organizationId: dbSchema.slot.organizationId,
      classroomId: dbSchema.slot.classroomId,
      status: dbSchema.slot.status,
    })
    .from(dbSchema.slot)
    .where(eq(dbSchema.slot.id, slotId))
    .limit(1);
  return rows[0] ?? null;
};

export const insertSlot = async ({
  database,
  slotId,
  organizationId,
  classroomId,
  serviceId,
  startAt,
  endAt,
  capacity,
  staffLabel,
  locationLabel,
  bookingOpenAt,
  bookingCloseAt,
}: {
  database: AuthRuntimeDatabase;
  slotId: string;
  organizationId: string;
  classroomId: string;
  serviceId: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  staffLabel: string | null;
  locationLabel: string | null;
  bookingOpenAt: Date;
  bookingCloseAt: Date;
}) => {
  await database.insert(dbSchema.slot).values({
    id: slotId,
    organizationId,
    classroomId,
    serviceId,
    recurringScheduleId: null,
    startAt,
    endAt,
    capacity,
    reservedCount: 0,
    status: SLOT_STATUS.OPEN,
    staffLabel,
    locationLabel,
    bookingOpenAt,
    bookingCloseAt,
  });
};

export const getSlotById = async (database: AuthRuntimeDatabase, slotId: string) => {
  const rows = await database
    .select()
    .from(dbSchema.slot)
    .where(eq(dbSchema.slot.id, slotId))
    .limit(1);
  return rows[0] ?? null;
};

export const updateSlot = async ({
  database,
  slotId,
  startAt,
  endAt,
  capacity,
  staffLabel,
  locationLabel,
  bookingOpenAt,
  bookingCloseAt,
}: {
  database: AuthRuntimeDatabase;
  slotId: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  staffLabel: string | null;
  locationLabel: string | null;
  bookingOpenAt: Date;
  bookingCloseAt: Date;
}) => {
  await database
    .update(dbSchema.slot)
    .set({
      startAt,
      endAt,
      capacity,
      staffLabel,
      locationLabel,
      bookingOpenAt,
      bookingCloseAt,
    })
    .where(eq(dbSchema.slot.id, slotId));
};

export const listSlots = async ({
  database,
  organizationId,
  classroomId,
  serviceId,
  status,
  from,
  to,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string;
  serviceId?: string;
  status?: string;
  from: Date;
  to: Date;
}) => {
  const filters = [
    eq(dbSchema.slot.organizationId, organizationId),
    gte(dbSchema.slot.startAt, from),
    lte(dbSchema.slot.startAt, to),
  ];
  if (classroomId) {
    filters.push(eq(dbSchema.slot.classroomId, classroomId));
  }
  if (serviceId) {
    filters.push(eq(dbSchema.slot.serviceId, serviceId));
  }
  if (status) {
    filters.push(eq(dbSchema.slot.status, status));
  }

  return database
    .select()
    .from(dbSchema.slot)
    .where(and(...filters))
    .orderBy(asc(dbSchema.slot.startAt));
};

export const listAvailableSlots = async ({
  database,
  organizationId,
  classroomId,
  serviceId,
  accessibleClassroomIds,
  from,
  to,
  now,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string;
  serviceId?: string;
  accessibleClassroomIds: string[];
  from: Date;
  to: Date;
  now: Date;
}) => {
  const filters = [
    eq(dbSchema.slot.organizationId, organizationId),
    eq(dbSchema.slot.status, SLOT_STATUS.OPEN),
    gte(dbSchema.slot.startAt, from),
    lte(dbSchema.slot.startAt, to),
    lte(dbSchema.slot.bookingOpenAt, now),
    gte(dbSchema.slot.bookingCloseAt, now),
    sql`${dbSchema.slot.reservedCount} < ${dbSchema.slot.capacity}`,
  ];
  filters.push(
    classroomId
      ? eq(dbSchema.slot.classroomId, classroomId)
      : inArray(dbSchema.slot.classroomId, accessibleClassroomIds),
  );
  if (serviceId) {
    filters.push(eq(dbSchema.slot.serviceId, serviceId));
  }

  return database
    .select()
    .from(dbSchema.slot)
    .where(and(...filters))
    .orderBy(asc(dbSchema.slot.startAt));
};

export const cancelSlotAndConfirmedBookings = async ({
  database,
  slotId,
  actorUserId,
  reason,
}: {
  database: AuthRuntimeDatabase;
  slotId: string;
  actorUserId: string;
  reason?: string;
}) => {
  await database
    .update(dbSchema.slot)
    .set({
      status: SLOT_STATUS.CANCELED,
    })
    .where(eq(dbSchema.slot.id, slotId));

  await database
    .update(dbSchema.booking)
    .set({
      status: BOOKING_STATUS.CANCELED_BY_STAFF,
      cancelReason: reason ?? 'slot-canceled',
      cancelledAt: new Date(),
      cancelledByUserId: actorUserId,
    })
    .where(
      and(
        eq(dbSchema.booking.slotId, slotId),
        eq(dbSchema.booking.status, BOOKING_STATUS.CONFIRMED),
      ),
    );
};
