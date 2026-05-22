import { resolveOrganizationId } from '../../domain/booking/authorization.js';
import { DEFAULT_TIMEZONE } from '../../domain/booking/constants.js';
import {
  defaultRecurringRange,
  isSupportedTimezone,
  syncRecurringScheduleSlots,
} from '../../domain/booking/recurring.js';
import { isRequestedClassroomMismatch } from '../../shared/classroom-policy.js';
import { assertSupportedTimezone, parseDateParts, parseIsoDateOrNull } from '../../shared/date.js';
import {
  serializeRecurringException,
  serializeRecurringSchedule,
} from '../../shared/serializers.js';
import {
  forbidden,
  jsonResult,
  notFound,
  unauthorized,
  validationError,
  type JsonRouteResult,
} from '../../shared/route-result.js';
import type { BookingRouteContext } from '../booking/booking-route-context.js';
import { RESERVE_APP_ENTITLEMENTS } from '../billing/policies/reserve-app-billing-policy.js';
import {
  findRecurringException,
  findRecurringScheduleScope,
  findServiceForRecurringSchedule,
  getRecurringException,
  getRecurringScheduleById,
  insertRecurringSchedule,
  listRecurringSchedules,
  updateRecurringSchedule,
  upsertRecurringException,
} from './recurring.repository.js';
import type {
  RecurringCreateBody,
  RecurringExceptionBody,
  RecurringGenerateBody,
  RecurringListQuery,
  RecurringUpdateBody,
} from './recurring.schemas.js';

const ensureCanManageSchedule = async ({
  ctx,
  headers,
  recurringScheduleId,
  classroomId,
}: {
  ctx: BookingRouteContext;
  headers: Headers;
  recurringScheduleId: string;
  classroomId?: string;
}) => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return { result: unauthorized(), identity: null, schedule: null };
  }

  const schedule = await findRecurringScheduleScope(ctx.database, recurringScheduleId);
  if (!schedule) {
    return { result: notFound('Recurring schedule not found.'), identity, schedule: null };
  }

  if (isRequestedClassroomMismatch(classroomId, schedule.classroomId)) {
    return { result: forbidden(), identity, schedule };
  }

  const hasAccess = await ctx.canManageClassroomScope({
    organizationId: schedule.organizationId,
    classroomId: schedule.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return { result: forbidden(), identity, schedule };
  }

  const premiumGate = await ctx.requireOrganizationEntitlement({
    organizationId: schedule.organizationId,
    key: RESERVE_APP_ENTITLEMENTS.ORGANIZATION_PREMIUM,
  });
  if (!premiumGate.allowed) {
    return { result: jsonResult(premiumGate.body, premiumGate.status), identity, schedule };
  }

  return { result: null, identity, schedule };
};

/**
 * recurring service の schedule を作成し、既定生成範囲の slot を同期します。
 */
export const createRecurringSchedule = async (
  ctx: BookingRouteContext,
  body: RecurringCreateBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const timezone = assertSupportedTimezone(body.timezone);
  if (!timezone) {
    return validationError(`Only ${DEFAULT_TIMEZONE} is supported in MVP.`);
  }

  const service = await findServiceForRecurringSchedule(ctx.database, body.serviceId);
  if (!service) {
    return notFound('Service not found.');
  }

  const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
  if (!organizationId || organizationId !== service.organizationId) {
    return forbidden();
  }

  if (body.classroomId && body.classroomId !== service.classroomId) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageClassroomScope({
    organizationId,
    classroomId: service.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const premiumGate = await ctx.requireOrganizationEntitlement({
    organizationId,
    key: RESERVE_APP_ENTITLEMENTS.ORGANIZATION_PREMIUM,
  });
  if (!premiumGate.allowed) {
    return jsonResult(premiumGate.body, premiumGate.status);
  }

  if (body.frequency === 'weekly' && body.byWeekday && body.byWeekday.length === 0) {
    return validationError('byWeekday must not be empty for weekly frequency.');
  }

  const startDateParts = parseDateParts(body.startDate);
  if (!startDateParts) {
    return validationError('Invalid startDate.');
  }

  if (body.endDate) {
    const endDateParts = parseDateParts(body.endDate);
    if (!endDateParts) {
      return validationError('Invalid endDate.');
    }
    if (new Date(body.endDate).getTime() < new Date(body.startDate).getTime()) {
      return validationError('endDate must be >= startDate.');
    }
  }

  const recurringScheduleId = crypto.randomUUID();
  await insertRecurringSchedule({
    database: ctx.database,
    recurringScheduleId,
    organizationId,
    classroomId: service.classroomId,
    serviceId: body.serviceId,
    timezone,
    frequency: body.frequency,
    interval: body.interval,
    byWeekday: body.byWeekday,
    byMonthday: body.byMonthday,
    startDate: body.startDate,
    endDate: body.endDate,
    startTimeLocal: body.startTimeLocal,
    durationMinutes: body.durationMinutes,
    capacityOverride: body.capacityOverride,
  });

  const { from, to } = defaultRecurringRange();
  const generated = await syncRecurringScheduleSlots({
    database: ctx.database,
    scheduleId: recurringScheduleId,
    from,
    to,
  });

  const schedule = await getRecurringScheduleById(ctx.database, recurringScheduleId);
  return jsonResult({
    ...serializeRecurringSchedule(schedule as Record<string, unknown> | undefined),
    generated,
  });
};

/**
 * staff が管理できる recurring schedule を scope と条件で絞り込んで返します。
 */
export const listManageableRecurringSchedules = async (
  ctx: BookingRouteContext,
  query: RecurringListQuery,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
  if (!organizationId) {
    return validationError('organizationId is required.');
  }

  const hasAccess = await ctx.canManageBookingsScope({
    organizationId,
    classroomId: query.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const rows = await listRecurringSchedules({
    database: ctx.database,
    organizationId,
    classroomId: query.classroomId,
    serviceId: query.serviceId,
    isActive: query.isActive,
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeRecurringSchedule(row)));
};

/**
 * recurring schedule を更新し、変更後の定義で既定生成範囲の slot を再同期します。
 */
export const updateExistingRecurringSchedule = async (
  ctx: BookingRouteContext,
  body: RecurringUpdateBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const guard = await ensureCanManageSchedule({
    ctx,
    headers,
    recurringScheduleId: body.recurringScheduleId,
    classroomId: body.classroomId,
  });
  if (guard.result || !guard.schedule) {
    return guard.result ?? notFound('Recurring schedule not found.');
  }

  if (body.timezone && !isSupportedTimezone(body.timezone)) {
    return validationError(`Only ${DEFAULT_TIMEZONE} is supported in MVP.`);
  }
  if (body.startDate && !parseDateParts(body.startDate)) {
    return validationError('Invalid startDate.');
  }
  if (body.endDate && !parseDateParts(body.endDate)) {
    return validationError('Invalid endDate.');
  }

  await updateRecurringSchedule({
    database: ctx.database,
    recurringScheduleId: guard.schedule.id,
    changes: {
      timezone: body.timezone,
      frequency: body.frequency,
      interval: body.interval,
      byWeekday: body.byWeekday,
      byMonthday: body.byMonthday,
      startDate: body.startDate,
      endDate: body.endDate,
      startTimeLocal: body.startTimeLocal,
      durationMinutes: body.durationMinutes,
      capacityOverride: body.capacityOverride,
      isActive: body.isActive,
    },
  });

  const { from, to } = defaultRecurringRange();
  const generated = await syncRecurringScheduleSlots({
    database: ctx.database,
    scheduleId: guard.schedule.id,
    from,
    to,
  });

  const updated = await getRecurringScheduleById(ctx.database, guard.schedule.id);
  return jsonResult({
    ...serializeRecurringSchedule(updated as Record<string, unknown> | undefined),
    generated,
  });
};

/**
 * 特定日の recurring exception を作成または更新し、影響範囲の slot を再同期します。
 */
export const upsertExistingRecurringException = async (
  ctx: BookingRouteContext,
  body: RecurringExceptionBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  if (body.action === 'override') {
    const hasAnyOverride =
      body.overrideStartTimeLocal !== undefined ||
      body.overrideDurationMinutes !== undefined ||
      body.overrideCapacity !== undefined;
    if (!hasAnyOverride) {
      return validationError('Override action requires at least one override field.');
    }
  }

  const guard = await ensureCanManageSchedule({
    ctx,
    headers,
    recurringScheduleId: body.recurringScheduleId,
    classroomId: body.classroomId,
  });
  if (guard.result || !guard.schedule) {
    return guard.result ?? notFound('Recurring schedule not found.');
  }

  const existing = await findRecurringException({
    database: ctx.database,
    recurringScheduleId: body.recurringScheduleId,
    date: body.date,
  });

  await upsertRecurringException({
    database: ctx.database,
    existingExceptionId: existing?.id,
    recurringScheduleId: body.recurringScheduleId,
    organizationId: guard.schedule.organizationId,
    classroomId: guard.schedule.classroomId,
    date: body.date,
    action: body.action,
    overrideStartTimeLocal: body.overrideStartTimeLocal,
    overrideDurationMinutes: body.overrideDurationMinutes,
    overrideCapacity: body.overrideCapacity,
  });

  const { from, to } = defaultRecurringRange();
  const generated = await syncRecurringScheduleSlots({
    database: ctx.database,
    scheduleId: body.recurringScheduleId,
    from,
    to,
  });

  const exception = await getRecurringException({
    database: ctx.database,
    recurringScheduleId: body.recurringScheduleId,
    date: body.date,
  });

  return jsonResult({
    ...serializeRecurringException(exception as Record<string, unknown> | undefined),
    generated,
  });
};

/**
 * recurring schedule から指定期間の slot を手動で同期生成します。
 */
export const generateRecurringSlots = async (
  ctx: BookingRouteContext,
  body: RecurringGenerateBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const guard = await ensureCanManageSchedule({
    ctx,
    headers,
    recurringScheduleId: body.recurringScheduleId,
    classroomId: body.classroomId,
  });
  if (guard.result || !guard.schedule) {
    return guard.result ?? notFound('Recurring schedule not found.');
  }

  const defaultRange = defaultRecurringRange();
  const from = parseIsoDateOrNull(body.from) ?? defaultRange.from;
  const to = parseIsoDateOrNull(body.to) ?? defaultRange.to;
  if (from.getTime() > to.getTime()) {
    return validationError('Invalid from/to.');
  }

  const generated = await syncRecurringScheduleSlots({
    database: ctx.database,
    scheduleId: body.recurringScheduleId,
    from,
    to,
  });

  return jsonResult({
    recurringScheduleId: body.recurringScheduleId,
    from: from.toISOString(),
    to: to.toISOString(),
    ...generated,
  });
};
