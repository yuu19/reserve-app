import { and, desc, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import * as dbSchema from '../../infra/db/schema.js';

/**
 * recurring schedule 作成時に service の所属 scope を確認するための情報を取得します。
 */
export const findServiceForRecurringSchedule = async (
  database: AuthRuntimeDatabase,
  serviceId: string,
) => {
  const rows = await database
    .select({
      id: dbSchema.service.id,
      organizationId: dbSchema.service.organizationId,
      classroomId: dbSchema.service.classroomId,
    })
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, serviceId))
    .limit(1);
  return rows[0] ?? null;
};

/**
 * recurring schedule を D1 に作成し、曜日指定は JSON 文字列として保存します。
 */
export const insertRecurringSchedule = async ({
  database,
  recurringScheduleId,
  organizationId,
  classroomId,
  serviceId,
  timezone,
  frequency,
  interval,
  byWeekday,
  byMonthday,
  startDate,
  endDate,
  startTimeLocal,
  durationMinutes,
  capacityOverride,
}: {
  database: AuthRuntimeDatabase;
  recurringScheduleId: string;
  organizationId: string;
  classroomId: string;
  serviceId: string;
  timezone: string;
  frequency: string;
  interval: number;
  byWeekday?: number[];
  byMonthday?: number;
  startDate: string;
  endDate?: string;
  startTimeLocal: string;
  durationMinutes?: number;
  capacityOverride?: number;
}) => {
  await database.insert(dbSchema.recurringSchedule).values({
    id: recurringScheduleId,
    organizationId,
    classroomId,
    serviceId,
    timezone,
    frequency,
    interval,
    byWeekdayJson: byWeekday ? JSON.stringify(byWeekday) : null,
    byMonthday: byMonthday ?? null,
    startDate,
    endDate: endDate ?? null,
    startTimeLocal,
    durationMinutes: durationMinutes ?? null,
    capacityOverride: capacityOverride ?? null,
    isActive: true,
  });
};

/**
 * recurring schedule の最新行を ID で取得します。
 */
export const getRecurringScheduleById = async (
  database: AuthRuntimeDatabase,
  recurringScheduleId: string,
) => {
  const rows = await database
    .select()
    .from(dbSchema.recurringSchedule)
    .where(eq(dbSchema.recurringSchedule.id, recurringScheduleId))
    .limit(1);
  return rows[0] ?? null;
};

/**
 * recurring schedule 操作前の権限判定に必要な scope 情報を取得します。
 */
export const findRecurringScheduleScope = async (
  database: AuthRuntimeDatabase,
  recurringScheduleId: string,
) => {
  const rows = await database
    .select({
      id: dbSchema.recurringSchedule.id,
      organizationId: dbSchema.recurringSchedule.organizationId,
      classroomId: dbSchema.recurringSchedule.classroomId,
    })
    .from(dbSchema.recurringSchedule)
    .where(eq(dbSchema.recurringSchedule.id, recurringScheduleId))
    .limit(1);
  return rows[0] ?? null;
};

/**
 * staff 向けに organization/classroom/service/status で recurring schedule を一覧します。
 */
export const listRecurringSchedules = async ({
  database,
  organizationId,
  classroomId,
  serviceId,
  isActive,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string;
  serviceId?: string;
  isActive?: boolean;
}) => {
  const filters = [eq(dbSchema.recurringSchedule.organizationId, organizationId)];
  if (classroomId) {
    filters.push(eq(dbSchema.recurringSchedule.classroomId, classroomId));
  }
  if (serviceId) {
    filters.push(eq(dbSchema.recurringSchedule.serviceId, serviceId));
  }
  if (isActive !== undefined) {
    filters.push(eq(dbSchema.recurringSchedule.isActive, isActive));
  }

  return database
    .select()
    .from(dbSchema.recurringSchedule)
    .where(and(...filters))
    .orderBy(desc(dbSchema.recurringSchedule.createdAt));
};

/**
 * 未指定フィールドを保持したまま recurring schedule の変更分だけを D1 に反映します。
 */
export const updateRecurringSchedule = async ({
  database,
  recurringScheduleId,
  changes,
}: {
  database: AuthRuntimeDatabase;
  recurringScheduleId: string;
  changes: {
    timezone?: string;
    frequency?: string;
    interval?: number;
    byWeekday?: number[];
    byMonthday?: number;
    startDate?: string;
    endDate?: string;
    startTimeLocal?: string;
    durationMinutes?: number;
    capacityOverride?: number;
    isActive?: boolean;
  };
}) => {
  await database
    .update(dbSchema.recurringSchedule)
    .set({
      ...(changes.timezone !== undefined ? { timezone: changes.timezone } : {}),
      ...(changes.frequency !== undefined ? { frequency: changes.frequency } : {}),
      ...(changes.interval !== undefined ? { interval: changes.interval } : {}),
      ...(changes.byWeekday !== undefined
        ? { byWeekdayJson: JSON.stringify(changes.byWeekday) }
        : {}),
      ...(changes.byMonthday !== undefined ? { byMonthday: changes.byMonthday } : {}),
      ...(changes.startDate !== undefined ? { startDate: changes.startDate } : {}),
      ...(changes.endDate !== undefined ? { endDate: changes.endDate } : {}),
      ...(changes.startTimeLocal !== undefined ? { startTimeLocal: changes.startTimeLocal } : {}),
      ...(changes.durationMinutes !== undefined
        ? { durationMinutes: changes.durationMinutes }
        : {}),
      ...(changes.capacityOverride !== undefined
        ? { capacityOverride: changes.capacityOverride }
        : {}),
      ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
    })
    .where(eq(dbSchema.recurringSchedule.id, recurringScheduleId));
};

/**
 * 特定日の recurring exception が既に存在するかを確認します。
 */
export const findRecurringException = async ({
  database,
  recurringScheduleId,
  date,
}: {
  database: AuthRuntimeDatabase;
  recurringScheduleId: string;
  date: string;
}) => {
  const rows = await database
    .select({
      id: dbSchema.recurringScheduleException.id,
    })
    .from(dbSchema.recurringScheduleException)
    .where(
      and(
        eq(dbSchema.recurringScheduleException.recurringScheduleId, recurringScheduleId),
        eq(dbSchema.recurringScheduleException.date, date),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

/**
 * recurring exception を同一日で upsert します。
 */
export const upsertRecurringException = async ({
  database,
  existingExceptionId,
  recurringScheduleId,
  organizationId,
  classroomId,
  date,
  action,
  overrideStartTimeLocal,
  overrideDurationMinutes,
  overrideCapacity,
}: {
  database: AuthRuntimeDatabase;
  existingExceptionId?: string;
  recurringScheduleId: string;
  organizationId: string;
  classroomId: string;
  date: string;
  action: string;
  overrideStartTimeLocal?: string;
  overrideDurationMinutes?: number;
  overrideCapacity?: number;
}) => {
  if (existingExceptionId) {
    await database
      .update(dbSchema.recurringScheduleException)
      .set({
        action,
        overrideStartTimeLocal: overrideStartTimeLocal ?? null,
        overrideDurationMinutes: overrideDurationMinutes ?? null,
        overrideCapacity: overrideCapacity ?? null,
      })
      .where(eq(dbSchema.recurringScheduleException.id, existingExceptionId));
    return;
  }

  await database.insert(dbSchema.recurringScheduleException).values({
    id: crypto.randomUUID(),
    recurringScheduleId,
    organizationId,
    classroomId,
    date,
    action,
    overrideStartTimeLocal: overrideStartTimeLocal ?? null,
    overrideDurationMinutes: overrideDurationMinutes ?? null,
    overrideCapacity: overrideCapacity ?? null,
  });
};

/**
 * 特定日の recurring exception 最新行を取得します。
 */
export const getRecurringException = async ({
  database,
  recurringScheduleId,
  date,
}: {
  database: AuthRuntimeDatabase;
  recurringScheduleId: string;
  date: string;
}) => {
  const rows = await database
    .select()
    .from(dbSchema.recurringScheduleException)
    .where(
      and(
        eq(dbSchema.recurringScheduleException.recurringScheduleId, recurringScheduleId),
        eq(dbSchema.recurringScheduleException.date, date),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};
