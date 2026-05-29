import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { BOOKING_STATUS, SLOT_STATUS } from '../../domain/booking/constants.js';
import * as dbSchema from '../../infra/db/schema.js';

/**
 * slot 作成・更新時に service 所属と予約受付窓を確認するための情報を取得します。
 */
export const findServiceForSlot = async (database: AuthRuntimeDatabase, serviceId: string) => {
  const rows = await database
    .select({
      id: dbSchema.service.id,
      organizationId: dbSchema.service.organizationId,
      storeId: dbSchema.service.storeId,
      bookingOpenMinutesBefore: dbSchema.service.bookingOpenMinutesBefore,
      bookingCloseMinutesBefore: dbSchema.service.bookingCloseMinutesBefore,
      capacity: dbSchema.service.capacity,
    })
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, serviceId))
    .limit(1);
  return rows[0] ?? null;
};

/**
 * slot 更新前に状態・予約数・scope を確認するための情報を取得します。
 */
export const findSlotForUpdate = async (database: AuthRuntimeDatabase, slotId: string) => {
  const rows = await database
    .select({
      id: dbSchema.slot.id,
      organizationId: dbSchema.slot.organizationId,
      storeId: dbSchema.slot.storeId,
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

/**
 * slot キャンセル前に状態と scope を確認するための情報を取得します。
 */
export const findSlotForCancel = async (database: AuthRuntimeDatabase, slotId: string) => {
  const rows = await database
    .select({
      id: dbSchema.slot.id,
      organizationId: dbSchema.slot.organizationId,
      storeId: dbSchema.slot.storeId,
      status: dbSchema.slot.status,
    })
    .from(dbSchema.slot)
    .where(eq(dbSchema.slot.id, slotId))
    .limit(1);
  return rows[0] ?? null;
};

/**
 * service の設定から解決済みの単発 slot を D1 に作成します。
 */
export const insertSlot = async ({
  database,
  slotId,
  organizationId,
  storeId,
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
  storeId: string;
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
    storeId,
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

/**
 * slot の最新行を ID で取得します。
 */
export const getSlotById = async (database: AuthRuntimeDatabase, slotId: string) => {
  const rows = await database
    .select()
    .from(dbSchema.slot)
    .where(eq(dbSchema.slot.id, slotId))
    .limit(1);
  return rows[0] ?? null;
};

/**
 * 予約がない open slot の日時・定員・表示情報を更新します。
 */
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

/**
 * staff 向けに、指定 scope と期間に一致する slot を開始日時順で一覧します。
 */
export const listSlots = async ({
  database,
  organizationId,
  storeId,
  serviceId,
  status,
  from,
  to,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string;
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
  if (storeId) {
    filters.push(eq(dbSchema.slot.storeId, storeId));
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

/**
 * participant がアクセスでき、受付中かつ空き定員のある slot だけを一覧します。
 */
export const listAvailableSlots = async ({
  database,
  organizationId,
  storeId,
  serviceId,
  accessibleStoreIds,
  from,
  to,
  now,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string;
  serviceId?: string;
  accessibleStoreIds: string[];
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
    storeId
      ? eq(dbSchema.slot.storeId, storeId)
      : inArray(dbSchema.slot.storeId, accessibleStoreIds),
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

/**
 * slot をキャンセルし、その slot の確定予約を staff キャンセル状態へまとめて遷移します。
 */
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
