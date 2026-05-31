import { resolveOrganizationId } from '../../domain/booking/authorization.js';
import { parseIsoDateOrNull } from '../../shared/date.js';
import { serializeBooking } from '../../shared/serializers.js';
import {
  forbidden,
  jsonResult,
  unauthorized,
  validationError,
  type JsonRouteResult,
} from '../../shared/route-result.js';
import type { BookingRouteContext } from './booking-route-context.js';
import { listBookingAnswersByBookingIds, listBookings } from './booking.repository.js';
import type { BookingListQuery, BookingMineQuery } from './booking.schemas.js';

const parseBookingAnswerValue = (valueJson: string): unknown => {
  try {
    return JSON.parse(valueJson) as unknown;
  } catch {
    return valueJson;
  }
};

const serializeBookingsWithAnswers = async (
  ctx: BookingRouteContext,
  rows: Array<Record<string, unknown>>,
) => {
  const bookingIds = rows
    .map((row) => (typeof row.id === 'string' ? row.id : null))
    .filter((id): id is string => Boolean(id));
  const answers = await listBookingAnswersByBookingIds({
    database: ctx.database,
    bookingIds,
  });
  const answersByBookingId = new Map<
    string,
    Array<{ id: string; fieldId: string; labelSnapshot: string; value: unknown }>
  >();
  for (const answer of answers) {
    const bookingAnswers = answersByBookingId.get(answer.bookingId) ?? [];
    bookingAnswers.push({
      id: answer.id,
      fieldId: answer.fieldId,
      labelSnapshot: answer.labelSnapshot,
      value: parseBookingAnswerValue(answer.valueJson),
    });
    answersByBookingId.set(answer.bookingId, bookingAnswers);
  }

  return rows.map((row) => ({
    ...serializeBooking(row),
    answers: typeof row.id === 'string' ? (answersByBookingId.get(row.id) ?? []) : [],
  }));
};

/**
 * participant 自身が参照できる予約だけを一覧します。
 */
export const listMyBookings = async (
  ctx: BookingRouteContext,
  query: BookingMineQuery,
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

  const participantRecords = await ctx.listParticipantRecordsForUser({
    organizationId,
    storeId: query.storeId,
    userId: identity.userId,
  });
  if (participantRecords.length === 0) {
    return forbidden();
  }
  const participantIds = participantRecords.map((participant) => participant.id);

  const rows = await listBookings({
    database: ctx.database,
    organizationId,
    storeId: query.storeId,
    participantIds,
    status: query.status,
    from: parseIsoDateOrNull(query.from),
    to: parseIsoDateOrNull(query.to),
  });

  return jsonResult(await serializeBookingsWithAnswers(ctx, rows as Array<Record<string, unknown>>));
};

/**
 * staff が管理権限を持つ予約を条件付きで一覧します。
 */
export const listStaffBookings = async (
  ctx: BookingRouteContext,
  query: BookingListQuery,
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
    storeId: query.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const rows = await listBookings({
    database: ctx.database,
    organizationId,
    storeId: query.storeId,
    serviceId: query.serviceId,
    participantId: query.participantId,
    status: query.status,
    from: parseIsoDateOrNull(query.from),
    to: parseIsoDateOrNull(query.to),
  });

  return jsonResult(await serializeBookingsWithAnswers(ctx, rows as Array<Record<string, unknown>>));
};
