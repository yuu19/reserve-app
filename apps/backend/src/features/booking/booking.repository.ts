import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import {
  BOOKING_ATTENDANCE_STATUS,
  BOOKING_STATUS,
  SLOT_STATUS,
  TICKET_LEDGER_ACTION,
  TICKET_PACK_STATUS,
} from '../../domain/booking/constants.js';
import * as dbSchema from '../../infra/db/schema.js';

/**
 * 予約作成時に slot の所属・受付窓・状態を確認するための情報を取得します。
 */
export const findSlotForBookingCreate = async (database: AuthRuntimeDatabase, slotId: string) => {
  const slotRows = await database
    .select({
      id: dbSchema.slot.id,
      organizationId: dbSchema.slot.organizationId,
      storeId: dbSchema.slot.storeId,
      serviceId: dbSchema.slot.serviceId,
      startAt: dbSchema.slot.startAt,
      endAt: dbSchema.slot.endAt,
      capacity: dbSchema.slot.capacity,
      reservedCount: dbSchema.slot.reservedCount,
      status: dbSchema.slot.status,
      bookingOpenAt: dbSchema.slot.bookingOpenAt,
      bookingCloseAt: dbSchema.slot.bookingCloseAt,
    })
    .from(dbSchema.slot)
    .where(eq(dbSchema.slot.id, slotId))
    .limit(1);
  return slotRows[0] ?? null;
};

/**
 * 予約作成・承認時に service の予約方式と回数券要否を取得します。
 */
export const findServiceForBookingCreate = async (
  database: AuthRuntimeDatabase,
  serviceId: string,
) => {
  const serviceRows = await database
    .select({
      id: dbSchema.service.id,
      bookingPolicy: dbSchema.service.bookingPolicy,
      requiresTicket: dbSchema.service.requiresTicket,
      isActive: dbSchema.service.isActive,
    })
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, serviceId))
    .limit(1);
  return serviceRows[0] ?? null;
};

/**
 * 予約行を指定 status で作成します。
 */
export const insertBooking = async ({
  database,
  bookingId,
  organizationId,
  storeId,
  slotId,
  serviceId,
  participantId,
  publicId,
  source,
  participantsCount,
  customerName,
  customerEmail,
  customerPhone,
  note,
  createdByUserId,
  status,
  ticketPackId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  organizationId: string;
  storeId: string;
  slotId: string;
  serviceId: string;
  participantId: string | null;
  publicId?: string | null;
  source?: string;
  participantsCount: number;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  createdByUserId?: string | null;
  status: string;
  ticketPackId: string | null;
}) => {
  await database.insert(dbSchema.booking).values({
    id: bookingId,
    organizationId,
    storeId,
    slotId,
    serviceId,
    participantId,
    publicId: publicId ?? null,
    source: source ?? 'participant',
    participantsCount,
    customerName: customerName ?? null,
    customerEmail: customerEmail ?? null,
    customerPhone: customerPhone ?? null,
    note: note ?? null,
    createdByUserId: createdByUserId ?? null,
    status,
    ticketPackId,
  });
};

export const insertBookingCompanions = async ({
  database,
  bookingId,
  companions,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  companions: Array<{ name: string; note?: string | null }>;
}) => {
  if (companions.length === 0) {
    return;
  }

  await database.insert(dbSchema.bookingCompanion).values(
    companions.map((companion) => ({
      id: crypto.randomUUID(),
      bookingId,
      name: companion.name,
      note: companion.note ?? null,
    })),
  );
};

export const insertBookingAnswers = async ({
  database,
  bookingId,
  answers,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  answers: Array<{ fieldId: string; labelSnapshot: string; valueJson: string }>;
}) => {
  if (answers.length === 0) {
    return;
  }

  await database.insert(dbSchema.bookingAnswer).values(
    answers.map((answer) => ({
      id: crypto.randomUUID(),
      bookingId,
      fieldId: answer.fieldId,
      labelSnapshot: answer.labelSnapshot,
      valueJson: answer.valueJson,
    })),
  );
};

/**
 * 予約の最新行を ID で取得します。
 */
export const getBookingById = async (database: AuthRuntimeDatabase, bookingId: string) => {
  const rows = await database
    .select()
    .from(dbSchema.booking)
    .where(eq(dbSchema.booking.id, bookingId))
    .limit(1);
  return rows[0] ?? null;
};

/**
 * 即時予約作成時に受付期間と定員を同時に確認しながら slot 定員を確保します。
 */
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

/**
 * 承認制予約の承認時に、slot が open で空き定員がある場合だけ定員を確保します。
 */
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

/**
 * 予約作成や承認の失敗時に、確保済み slot 定員を補償的に戻します。
 */
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

/**
 * 予約で消費した ticket pack の ledger を append-only に記録します。
 */
export const consumeBookingTicketLedger = async ({
  database,
  organizationId,
  storeId,
  ticketPackId,
  bookingId,
  participantsCount,
  balanceAfter,
  actorUserId,
  reason,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
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
    storeId,
    ticketPackId,
    bookingId,
    action: TICKET_LEDGER_ACTION.CONSUME,
    delta: participantsCount * -1,
    balanceAfter,
    actorUserId,
    reason,
  });
};

/**
 * participant キャンセル時に本人確認と状態遷移へ必要な予約 scope を取得します。
 */
export const findBookingForParticipantCancel = async (
  database: AuthRuntimeDatabase,
  bookingId: string,
) => {
  const bookingRows = await database
    .select({
      id: dbSchema.booking.id,
      organizationId: dbSchema.booking.organizationId,
      storeId: dbSchema.booking.storeId,
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

/**
 * staff 操作時に予約の organization/store scope と現在状態を取得します。
 */
export const findBookingScope = async (database: AuthRuntimeDatabase, bookingId: string) => {
  const bookingRows = await database
    .select({
      id: dbSchema.booking.id,
      organizationId: dbSchema.booking.organizationId,
      storeId: dbSchema.booking.storeId,
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

/**
 * staff 日程変更で現在の予約 scope と変更前 slot snapshot を取得します。
 */
export const findBookingForReschedule = async (
  database: AuthRuntimeDatabase,
  bookingId: string,
) => {
  const bookingRows = await database
    .select({
      id: dbSchema.booking.id,
      organizationId: dbSchema.booking.organizationId,
      storeId: dbSchema.booking.storeId,
      slotId: dbSchema.booking.slotId,
      serviceId: dbSchema.booking.serviceId,
      participantId: dbSchema.booking.participantId,
      participantsCount: dbSchema.booking.participantsCount,
      status: dbSchema.booking.status,
      currentSlotStartAt: dbSchema.slot.startAt,
      currentSlotEndAt: dbSchema.slot.endAt,
    })
    .from(dbSchema.booking)
    .innerJoin(dbSchema.slot, eq(dbSchema.slot.id, dbSchema.booking.slotId))
    .where(eq(dbSchema.booking.id, bookingId))
    .limit(1);
  return bookingRows[0] ?? null;
};

/**
 * 日程変更先として指定された slot の所属・状態・定員 snapshot を取得します。
 */
export const findSlotForBookingReschedule = async (
  database: AuthRuntimeDatabase,
  slotId: string,
) => {
  const slotRows = await database
    .select({
      id: dbSchema.slot.id,
      organizationId: dbSchema.slot.organizationId,
      storeId: dbSchema.slot.storeId,
      serviceId: dbSchema.slot.serviceId,
      startAt: dbSchema.slot.startAt,
      endAt: dbSchema.slot.endAt,
      capacity: dbSchema.slot.capacity,
      reservedCount: dbSchema.slot.reservedCount,
      status: dbSchema.slot.status,
    })
    .from(dbSchema.slot)
    .where(eq(dbSchema.slot.id, slotId))
    .limit(1);
  return slotRows[0] ?? null;
};

/**
 * キャンセル期限判定に使う slot 開始日時を取得します。
 */
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

/**
 * service ごとのキャンセル期限設定を取得します。
 */
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

/**
 * participant 操作として予約をキャンセル状態に更新します。
 */
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

/**
 * staff 操作として予約をキャンセル状態に更新します。
 */
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

/**
 * 確定予約のキャンセル後に、slot の reservedCount を過剰に戻さない条件で減算します。
 */
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

/**
 * 日程変更先の open/future slot で定員が足りる場合だけ定員を確保します。
 */
export const reserveSlotCapacityForReschedule = async ({
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
        gte(dbSchema.slot.startAt, now),
        sql`${dbSchema.slot.reservedCount} + ${participantsCount} <= ${dbSchema.slot.capacity}`,
      ),
    )
    .returning({ id: dbSchema.slot.id });
  return capacityRows.length > 0;
};

/**
 * 確定予約の slot 参照を、現在 slot から変更先 slot へ更新します。
 */
export const updateConfirmedBookingSlot = async ({
  database,
  bookingId,
  currentSlotId,
  targetSlotId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  currentSlotId: string;
  targetSlotId: string;
}) => {
  const updatedRows = await database
    .update(dbSchema.booking)
    .set({
      slotId: targetSlotId,
    })
    .where(
      and(
        eq(dbSchema.booking.id, bookingId),
        eq(dbSchema.booking.slotId, currentSlotId),
        eq(dbSchema.booking.status, BOOKING_STATUS.CONFIRMED),
      ),
    )
    .returning({ id: dbSchema.booking.id });
  return updatedRows.length > 0;
};

/**
 * 日程変更の前後 snapshot と理由を append-only に記録します。
 */
export const insertBookingChangeLog = async ({
  database,
  bookingId,
  organizationId,
  storeId,
  beforeJson,
  afterJson,
  reason,
  changedByUserId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  organizationId: string;
  storeId: string;
  beforeJson: string;
  afterJson: string;
  reason?: string | null;
  changedByUserId: string;
}) => {
  const id = crypto.randomUUID();
  await database.insert(dbSchema.bookingChangeLog).values({
    id,
    bookingId,
    organizationId,
    storeId,
    beforeJson,
    afterJson,
    reason: reason ?? null,
    changedByUserId,
  });
  return id;
};

/**
 * 予約キャンセルで ticket pack 残数を戻し、復元 ledger を記録します。
 */
export const restoreTicketPackForBookingCancel = async ({
  database,
  organizationId,
  storeId,
  ticketPackId,
  bookingId,
  participantsCount,
  actorUserId,
  reason,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
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
    storeId,
    ticketPackId,
    bookingId,
    action: TICKET_LEDGER_ACTION.RESTORE,
    delta: participantsCount,
    balanceAfter: pack?.remainingCount ?? 0,
    actorUserId,
    reason,
  });
};

/**
 * 承認待ち予約だけを確定予約へ遷移させ、必要なら ticketPackId を紐づけます。
 */
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

/**
 * 承認待ち予約だけを staff 却下状態へ遷移させます。
 */
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

/**
 * 確定予約を no-show として記録します。
 */
export const markConfirmedBookingNoShow = async ({
  database,
  bookingId,
  actorUserId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  actorUserId: string;
}) => {
  const markedAt = new Date();
  await database
    .update(dbSchema.booking)
    .set({
      status: BOOKING_STATUS.NO_SHOW,
      noShowMarkedAt: markedAt,
      attendanceStatus: BOOKING_ATTENDANCE_STATUS.NO_SHOW,
      attendanceMarkedAt: markedAt,
      attendanceMarkedByUserId: actorUserId,
    })
    .where(eq(dbSchema.booking.id, bookingId));
};

/**
 * 確定予約の出席・欠席状態を記録します。
 */
export const markConfirmedBookingAttendance = async ({
  database,
  bookingId,
  attendanceStatus,
  actorUserId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  attendanceStatus:
    | typeof BOOKING_ATTENDANCE_STATUS.NOT_CHECKED
    | typeof BOOKING_ATTENDANCE_STATUS.CHECKED_IN
    | typeof BOOKING_ATTENDANCE_STATUS.ABSENT;
  actorUserId: string;
}) => {
  const shouldClearMark = attendanceStatus === BOOKING_ATTENDANCE_STATUS.NOT_CHECKED;
  const updatedRows = await database
    .update(dbSchema.booking)
    .set({
      attendanceStatus,
      attendanceMarkedAt: shouldClearMark ? null : new Date(),
      attendanceMarkedByUserId: shouldClearMark ? null : actorUserId,
    })
    .where(
      and(
        eq(dbSchema.booking.id, bookingId),
        eq(dbSchema.booking.status, BOOKING_STATUS.CONFIRMED),
      ),
    )
    .returning({ id: dbSchema.booking.id });
  return updatedRows.length > 0;
};

/**
 * participant/staff それぞれの権限境界で使う予約一覧を条件付きで取得します。
 */
export const listBookings = async ({
  database,
  organizationId,
  storeId,
  serviceId,
  participantId,
  participantIds,
  status,
  from,
  to,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string;
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
  if (storeId) {
    filters.push(eq(dbSchema.booking.storeId, storeId));
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
