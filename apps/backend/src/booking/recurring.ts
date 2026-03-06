import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import { DEFAULT_TIMEZONE, RECURRING_HORIZON_DAYS, SLOT_STATUS } from './constants.js';

const JST_OFFSET_MINUTES = 9 * 60;
const JST_OFFSET_MS = JST_OFFSET_MINUTES * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type RecurringScheduleRow = {
  id: string;
  organizationId: string;
  classroomId: string;
  serviceId: string;
  timezone: string;
  frequency: string;
  interval: number;
  byWeekdayJson: string | null;
  byMonthday: number | null;
  startDate: string;
  endDate: string | null;
  startTimeLocal: string;
  durationMinutes: number | null;
  capacityOverride: number | null;
  isActive: boolean;
};

type RecurringExceptionRow = {
  id: string;
  recurringScheduleId: string;
  organizationId: string;
  classroomId: string;
  date: string;
  action: string;
  overrideStartTimeLocal: string | null;
  overrideDurationMinutes: number | null;
  overrideCapacity: number | null;
};

type ServiceRow = {
  id: string;
  organizationId: string;
  classroomId: string;
  durationMinutes: number;
  capacity: number;
  bookingOpenMinutesBefore: number | null;
  bookingCloseMinutesBefore: number | null;
};

type SlotDraft = {
  id: string;
  organizationId: string;
  classroomId: string;
  serviceId: string;
  recurringScheduleId: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  status: string;
  bookingOpenAt: Date;
  bookingCloseAt: Date;
};

export const isSupportedTimezone = (timezone: string | null | undefined): boolean => {
  return !timezone || timezone === DEFAULT_TIMEZONE;
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const parseDateOnly = (date: string): { year: number; month: number; day: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { year, month, day };
};

const parseTimeLocal = (time: string): { hour: number; minute: number } | null => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) {
    return null;
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
};

const toUtcFromJstComponents = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date => {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0));
};

const dateKeyInJst = (value: Date): string => {
  const jstMs = value.getTime() + JST_OFFSET_MS;
  const jstDate = new Date(jstMs);
  return `${jstDate.getUTCFullYear()}-${pad2(jstDate.getUTCMonth() + 1)}-${pad2(jstDate.getUTCDate())}`;
};

const isoWeekdayFromDate = (value: Date): number => {
  const jstMs = value.getTime() + JST_OFFSET_MS;
  const jstDate = new Date(jstMs);
  const weekday = jstDate.getUTCDay();
  return weekday === 0 ? 7 : weekday;
};

const startOfDayJstAsUtc = (year: number, month: number, day: number): Date => {
  return toUtcFromJstComponents(year, month, day, 0, 0);
};

const lastDayOfMonth = (year: number, month: number): number => {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

const monthsDiff = (
  left: { year: number; month: number },
  right: { year: number; month: number },
): number => {
  return (left.year - right.year) * 12 + (left.month - right.month);
};

const computeBookingWindow = ({
  now,
  startAt,
  bookingOpenMinutesBefore,
  bookingCloseMinutesBefore,
}: {
  now: Date;
  startAt: Date;
  bookingOpenMinutesBefore: number | null;
  bookingCloseMinutesBefore: number | null;
}): { bookingOpenAt: Date; bookingCloseAt: Date } => {
  const bookingOpenAt =
    typeof bookingOpenMinutesBefore === 'number' && bookingOpenMinutesBefore >= 0
      ? new Date(startAt.getTime() - bookingOpenMinutesBefore * 60 * 1000)
      : now;

  const bookingCloseAt =
    typeof bookingCloseMinutesBefore === 'number' && bookingCloseMinutesBefore >= 0
      ? new Date(startAt.getTime() - bookingCloseMinutesBefore * 60 * 1000)
      : startAt;

  if (bookingOpenAt.getTime() <= bookingCloseAt.getTime()) {
    return { bookingOpenAt, bookingCloseAt };
  }

  return {
    bookingOpenAt: bookingCloseAt,
    bookingCloseAt,
  };
};

const parseByWeekday = (value: string | null): number[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const weekdays = parsed
      .map((entry) => Number(entry))
      .filter((weekday) => Number.isInteger(weekday) && weekday >= 1 && weekday <= 7);
    return Array.from(new Set(weekdays)).sort((a, b) => a - b);
  } catch {
    return [];
  }
};

const buildWeeklyStartAts = ({
  schedule,
  rangeStart,
  rangeEnd,
}: {
  schedule: RecurringScheduleRow;
  rangeStart: Date;
  rangeEnd: Date;
}): Date[] => {
  const startDateParts = parseDateOnly(schedule.startDate);
  if (!startDateParts) {
    return [];
  }

  const localTime = parseTimeLocal(schedule.startTimeLocal);
  if (!localTime) {
    return [];
  }

  const interval = Math.max(1, schedule.interval);
  const weekdays = parseByWeekday(schedule.byWeekdayJson);
  const activeWeekdays = weekdays.length > 0 ? weekdays : [isoWeekdayFromDate(startOfDayJstAsUtc(startDateParts.year, startDateParts.month, startDateParts.day))];

  const scheduleStartDay = startOfDayJstAsUtc(startDateParts.year, startDateParts.month, startDateParts.day);
  const endDateParts = schedule.endDate ? parseDateOnly(schedule.endDate) : null;
  const scheduleEndDay = endDateParts
    ? startOfDayJstAsUtc(endDateParts.year, endDateParts.month, endDateParts.day)
    : null;

  const iterStartMs = Math.max(rangeStart.getTime(), scheduleStartDay.getTime());
  const iterEndMs = scheduleEndDay
    ? Math.min(rangeEnd.getTime(), scheduleEndDay.getTime() + DAY_MS - 1)
    : rangeEnd.getTime();

  const starts: Date[] = [];
  for (let dayMs = iterStartMs; dayMs <= iterEndMs; dayMs += DAY_MS) {
    const dayStart = new Date(dayMs);
    const isoWeekday = isoWeekdayFromDate(dayStart);
    if (!activeWeekdays.includes(isoWeekday)) {
      continue;
    }

    const diffDays = Math.floor((dayStart.getTime() - scheduleStartDay.getTime()) / DAY_MS);
    const elapsedWeeks = Math.floor(diffDays / 7);
    if (elapsedWeeks < 0 || elapsedWeeks % interval !== 0) {
      continue;
    }

    const dateKey = dateKeyInJst(dayStart);
    const parts = parseDateOnly(dateKey);
    if (!parts) {
      continue;
    }

    const occurrence = toUtcFromJstComponents(
      parts.year,
      parts.month,
      parts.day,
      localTime.hour,
      localTime.minute,
    );

    if (occurrence.getTime() < rangeStart.getTime() || occurrence.getTime() > rangeEnd.getTime()) {
      continue;
    }

    starts.push(occurrence);
  }

  return starts;
};

const buildMonthlyStartAts = ({
  schedule,
  rangeStart,
  rangeEnd,
}: {
  schedule: RecurringScheduleRow;
  rangeStart: Date;
  rangeEnd: Date;
}): Date[] => {
  const startDateParts = parseDateOnly(schedule.startDate);
  if (!startDateParts) {
    return [];
  }

  const localTime = parseTimeLocal(schedule.startTimeLocal);
  if (!localTime) {
    return [];
  }

  const interval = Math.max(1, schedule.interval);
  const baseMonth = { year: startDateParts.year, month: startDateParts.month };
  const targetDay = schedule.byMonthday ?? startDateParts.day;
  const endDateParts = schedule.endDate ? parseDateOnly(schedule.endDate) : null;

  const jstRangeStart = new Date(rangeStart.getTime() + JST_OFFSET_MS);
  const jstRangeEnd = new Date(rangeEnd.getTime() + JST_OFFSET_MS);
  const startMonth = { year: jstRangeStart.getUTCFullYear(), month: jstRangeStart.getUTCMonth() + 1 };
  const endMonth = { year: jstRangeEnd.getUTCFullYear(), month: jstRangeEnd.getUTCMonth() + 1 };

  const starts: Date[] = [];
  for (
    let cursor = { ...startMonth };
    monthsDiff(endMonth, cursor) >= 0;
    cursor = cursor.month === 12 ? { year: cursor.year + 1, month: 1 } : { year: cursor.year, month: cursor.month + 1 }
  ) {
    const diff = monthsDiff(cursor, baseMonth);
    if (diff < 0 || diff % interval !== 0) {
      continue;
    }

    const lastDay = lastDayOfMonth(cursor.year, cursor.month);
    const roundedDay = Math.min(Math.max(1, targetDay), lastDay);
    const occurrence = toUtcFromJstComponents(
      cursor.year,
      cursor.month,
      roundedDay,
      localTime.hour,
      localTime.minute,
    );

    const occurrenceDateKey = dateKeyInJst(occurrence);
    const occurrenceDateParts = parseDateOnly(occurrenceDateKey);
    if (!occurrenceDateParts) {
      continue;
    }

    const occurrenceDay = startOfDayJstAsUtc(
      occurrenceDateParts.year,
      occurrenceDateParts.month,
      occurrenceDateParts.day,
    );
    const scheduleStartDay = startOfDayJstAsUtc(
      startDateParts.year,
      startDateParts.month,
      startDateParts.day,
    );
    if (occurrenceDay.getTime() < scheduleStartDay.getTime()) {
      continue;
    }

    if (endDateParts) {
      const scheduleEndDay = startOfDayJstAsUtc(endDateParts.year, endDateParts.month, endDateParts.day);
      if (occurrenceDay.getTime() > scheduleEndDay.getTime()) {
        continue;
      }
    }

    if (occurrence.getTime() < rangeStart.getTime() || occurrence.getTime() > rangeEnd.getTime()) {
      continue;
    }

    starts.push(occurrence);
  }

  return starts;
};

const buildOccurrenceStarts = ({
  schedule,
  rangeStart,
  rangeEnd,
}: {
  schedule: RecurringScheduleRow;
  rangeStart: Date;
  rangeEnd: Date;
}): Date[] => {
  if (schedule.frequency === 'weekly') {
    return buildWeeklyStartAts({ schedule, rangeStart, rangeEnd });
  }
  if (schedule.frequency === 'monthly') {
    return buildMonthlyStartAts({ schedule, rangeStart, rangeEnd });
  }
  return [];
};

export const buildRecurringSlots = ({
  schedule,
  service,
  exceptions,
  existingStartAtMs,
  now,
  rangeStart,
  rangeEnd,
}: {
  schedule: RecurringScheduleRow;
  service: ServiceRow;
  exceptions: RecurringExceptionRow[];
  existingStartAtMs: Set<number>;
  now: Date;
  rangeStart: Date;
  rangeEnd: Date;
}): SlotDraft[] => {
  const starts = buildOccurrenceStarts({ schedule, rangeStart, rangeEnd });
  const exceptionByDate = new Map(exceptions.map((entry) => [entry.date, entry]));
  const slots: SlotDraft[] = [];

  for (const startAt of starts) {
    if (existingStartAtMs.has(startAt.getTime())) {
      continue;
    }

    const dateKey = dateKeyInJst(startAt);
    const exception = exceptionByDate.get(dateKey);
    if (exception?.action === 'skip') {
      continue;
    }

    const overrideTime = exception?.action === 'override' ? exception.overrideStartTimeLocal : null;
    const overrideDurationMinutes =
      exception?.action === 'override' ? exception.overrideDurationMinutes : null;
    const overrideCapacity = exception?.action === 'override' ? exception.overrideCapacity : null;

    let effectiveStartAt = startAt;
    if (overrideTime) {
      const date = parseDateOnly(dateKey);
      const time = parseTimeLocal(overrideTime);
      if (date && time) {
        effectiveStartAt = toUtcFromJstComponents(
          date.year,
          date.month,
          date.day,
          time.hour,
          time.minute,
        );
      }
    }

    const durationMinutes =
      overrideDurationMinutes ??
      schedule.durationMinutes ??
      service.durationMinutes;

    const capacity = overrideCapacity ?? schedule.capacityOverride ?? service.capacity;
    const endAt = new Date(effectiveStartAt.getTime() + durationMinutes * 60 * 1000);
    const { bookingOpenAt, bookingCloseAt } = computeBookingWindow({
      now,
      startAt: effectiveStartAt,
      bookingOpenMinutesBefore: service.bookingOpenMinutesBefore,
      bookingCloseMinutesBefore: service.bookingCloseMinutesBefore,
    });

    slots.push({
      id: crypto.randomUUID(),
      organizationId: schedule.organizationId,
      classroomId: schedule.classroomId,
      serviceId: schedule.serviceId,
      recurringScheduleId: schedule.id,
      startAt: effectiveStartAt,
      endAt,
      capacity,
      status: SLOT_STATUS.OPEN,
      bookingOpenAt,
      bookingCloseAt,
    });
  }

  return slots.sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
};

export const defaultRecurringRange = (now: Date = new Date()): { from: Date; to: Date } => {
  const from = now;
  const to = new Date(now.getTime() + RECURRING_HORIZON_DAYS * DAY_MS);
  return { from, to };
};

export const syncRecurringScheduleSlots = async ({
  database,
  scheduleId,
  from,
  to,
}: {
  database: AuthRuntimeDatabase;
  scheduleId: string;
  from: Date;
  to: Date;
}): Promise<{ createdCount: number; canceledCount: number }> => {
  const scheduleRows = await database
    .select({
      id: dbSchema.recurringSchedule.id,
      organizationId: dbSchema.recurringSchedule.organizationId,
      classroomId: dbSchema.recurringSchedule.classroomId,
      serviceId: dbSchema.recurringSchedule.serviceId,
      timezone: dbSchema.recurringSchedule.timezone,
      frequency: dbSchema.recurringSchedule.frequency,
      interval: dbSchema.recurringSchedule.interval,
      byWeekdayJson: dbSchema.recurringSchedule.byWeekdayJson,
      byMonthday: dbSchema.recurringSchedule.byMonthday,
      startDate: dbSchema.recurringSchedule.startDate,
      endDate: dbSchema.recurringSchedule.endDate,
      startTimeLocal: dbSchema.recurringSchedule.startTimeLocal,
      durationMinutes: dbSchema.recurringSchedule.durationMinutes,
      capacityOverride: dbSchema.recurringSchedule.capacityOverride,
      isActive: dbSchema.recurringSchedule.isActive,
    })
    .from(dbSchema.recurringSchedule)
    .where(eq(dbSchema.recurringSchedule.id, scheduleId))
    .limit(1);

  const schedule = scheduleRows[0];
  if (!schedule || !schedule.isActive) {
    return { createdCount: 0, canceledCount: 0 };
  }

  if (!isSupportedTimezone(schedule.timezone)) {
    return { createdCount: 0, canceledCount: 0 };
  }

  const serviceRows = await database
    .select({
      id: dbSchema.service.id,
      organizationId: dbSchema.service.organizationId,
      classroomId: dbSchema.service.classroomId,
      durationMinutes: dbSchema.service.durationMinutes,
      capacity: dbSchema.service.capacity,
      bookingOpenMinutesBefore: dbSchema.service.bookingOpenMinutesBefore,
      bookingCloseMinutesBefore: dbSchema.service.bookingCloseMinutesBefore,
    })
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, schedule.serviceId))
    .limit(1);

  const service = serviceRows[0];
  if (!service) {
    return { createdCount: 0, canceledCount: 0 };
  }

  const exceptionRows = await database
    .select({
      id: dbSchema.recurringScheduleException.id,
      recurringScheduleId: dbSchema.recurringScheduleException.recurringScheduleId,
      organizationId: dbSchema.recurringScheduleException.organizationId,
      classroomId: dbSchema.recurringScheduleException.classroomId,
      date: dbSchema.recurringScheduleException.date,
      action: dbSchema.recurringScheduleException.action,
      overrideStartTimeLocal: dbSchema.recurringScheduleException.overrideStartTimeLocal,
      overrideDurationMinutes: dbSchema.recurringScheduleException.overrideDurationMinutes,
      overrideCapacity: dbSchema.recurringScheduleException.overrideCapacity,
    })
    .from(dbSchema.recurringScheduleException)
    .where(eq(dbSchema.recurringScheduleException.recurringScheduleId, schedule.id));

  const existingSlots = await database
    .select({
      id: dbSchema.slot.id,
      startAt: dbSchema.slot.startAt,
      status: dbSchema.slot.status,
      reservedCount: dbSchema.slot.reservedCount,
    })
    .from(dbSchema.slot)
    .where(
      and(
        eq(dbSchema.slot.recurringScheduleId, schedule.id),
        gte(dbSchema.slot.startAt, from),
        lte(dbSchema.slot.startAt, to),
      ),
    );

  const existingStartAtMs = new Set<number>(
    existingSlots.map((slot: { startAt: unknown }) =>
      slot.startAt instanceof Date ? slot.startAt.getTime() : Number(slot.startAt),
    ),
  );

  const now = new Date();
  const slotsToCreate = buildRecurringSlots({
    schedule,
    service,
    exceptions: exceptionRows,
    existingStartAtMs,
    now,
    rangeStart: from,
    rangeEnd: to,
  });

  if (slotsToCreate.length > 0) {
    const chunkSize = 4;
    for (let index = 0; index < slotsToCreate.length; index += chunkSize) {
      const chunk = slotsToCreate.slice(index, index + chunkSize);
      await database.insert(dbSchema.slot).values(chunk);
    }
  }

  const skipExceptionDates = exceptionRows
    .filter((entry: RecurringExceptionRow) => entry.action === 'skip')
    .map((entry: RecurringExceptionRow) => entry.date);

  let canceledCount = 0;
  if (skipExceptionDates.length > 0) {
    const candidateSlots = existingSlots.filter((slot: { id: string; startAt: unknown }) => {
      const slotStartAt =
        slot.startAt instanceof Date
          ? slot.startAt
          : new Date(typeof slot.startAt === 'string' || typeof slot.startAt === 'number' ? slot.startAt : 0);
      return skipExceptionDates.includes(dateKeyInJst(slotStartAt));
    });

    if (candidateSlots.length > 0) {
      const slotIds = candidateSlots.map((slot: { id: string }) => slot.id);
      const result = await database
        .update(dbSchema.slot)
        .set({
          status: SLOT_STATUS.CANCELED,
        })
        .where(
          and(
            inArray(dbSchema.slot.id, slotIds),
            eq(dbSchema.slot.reservedCount, 0),
            eq(dbSchema.slot.status, SLOT_STATUS.OPEN),
          ),
        );

      canceledCount = Number((result as { rowsAffected?: number }).rowsAffected ?? 0);
    }
  }

  await database
    .update(dbSchema.recurringSchedule)
    .set({
      lastGeneratedAt: now,
    })
    .where(eq(dbSchema.recurringSchedule.id, schedule.id));

  return { createdCount: slotsToCreate.length, canceledCount };
};
