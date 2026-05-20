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
import type { BookingRouteContext } from '../../shared/route-context.js';
import { listBookings } from './booking.repository.js';
import type { BookingListQuery, BookingMineQuery } from './booking.schemas.js';

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
    classroomId: query.classroomId,
    userId: identity.userId,
  });
  if (participantRecords.length === 0) {
    return forbidden();
  }
  const participantIds = participantRecords.map((participant) => participant.id);

  const rows = await listBookings({
    database: ctx.database,
    organizationId,
    classroomId: query.classroomId,
    participantIds,
    status: query.status,
    from: parseIsoDateOrNull(query.from),
    to: parseIsoDateOrNull(query.to),
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeBooking(row)));
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
    classroomId: query.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const rows = await listBookings({
    database: ctx.database,
    organizationId,
    classroomId: query.classroomId,
    serviceId: query.serviceId,
    participantId: query.participantId,
    status: query.status,
    from: parseIsoDateOrNull(query.from),
    to: parseIsoDateOrNull(query.to),
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeBooking(row)));
};
