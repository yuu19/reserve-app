import { resolveOrganizationId } from '../../domain/booking/authorization.js';
import { writeBookingAuditLog } from '../../domain/booking/audit.js';
import {
  BOOKING_AUDIT_ACTION,
  DEFAULT_TIMEZONE,
  SLOT_PUBLIC_STATUS,
  SLOT_STATUS,
} from '../../domain/booking/constants.js';
import { isRequestedStoreMismatch } from '../../shared/store-policy.js';
import { parseIsoDateOrNull } from '../../shared/date.js';
import { serializeSlot } from '../../shared/serializers.js';
import {
  conflict,
  forbidden,
  jsonResult,
  notFound,
  unauthorized,
  validationError,
  type JsonRouteResult,
} from '../../shared/route-result.js';
import type { BookingRouteContext } from '../booking/booking-route-context.js';
import {
  cancelSlotAndConfirmedBookings,
  findServiceForSlot,
  findSlotForCancel,
  findSlotForUpdate,
  getSlotById,
  insertSlot,
  listAvailableSlots,
  listSlots,
  updateSlot,
  updateSlotPublicStatus,
} from './slot.repository.js';
import type {
  SlotAvailableQuery,
  SlotCancelBody,
  SlotCreateBody,
  SlotListQuery,
  SlotPublicStatusUpdateBody,
  SlotUpdateBody,
} from './slot.schemas.js';

type CancelledSlotBooking = {
  id: string;
  organizationId: string;
  storeId: string;
};

const normalizeOptionalText = (value: string | undefined): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const resolveSlotBookingWindow = ({
  startAt,
  bookingOpenMinutesBefore,
  bookingCloseMinutesBefore,
}: {
  startAt: Date;
  bookingOpenMinutesBefore: number | null | undefined;
  bookingCloseMinutesBefore: number | null | undefined;
}) => {
  const bookingOpenAt =
    typeof bookingOpenMinutesBefore === 'number'
      ? new Date(startAt.getTime() - bookingOpenMinutesBefore * 60 * 1000)
      : new Date();
  const bookingCloseAt =
    typeof bookingCloseMinutesBefore === 'number'
      ? new Date(startAt.getTime() - bookingCloseMinutesBefore * 60 * 1000)
      : startAt;
  const finalBookingOpenAt =
    bookingOpenAt.getTime() <= bookingCloseAt.getTime() ? bookingOpenAt : bookingCloseAt;

  return {
    bookingOpenAt: finalBookingOpenAt,
    bookingCloseAt,
  };
};

/**
 * service 所属と store 管理権限を確認し、予約受付窓を解決して slot を作成します。
 */
export const createSlot = async (
  ctx: BookingRouteContext,
  body: SlotCreateBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const startAt = parseIsoDateOrNull(body.startAt);
  const endAt = parseIsoDateOrNull(body.endAt);
  if (!startAt || !endAt || startAt.getTime() >= endAt.getTime()) {
    return validationError('Invalid slot startAt/endAt.');
  }

  const service = await findServiceForSlot(ctx.database, body.serviceId);
  if (!service) {
    return notFound('Service not found.');
  }

  const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
  if (!organizationId || organizationId !== service.organizationId) {
    return forbidden();
  }

  if (body.storeId && body.storeId !== service.storeId) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageStoreScope({
    organizationId,
    storeId: service.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const slotBookingWindow = resolveSlotBookingWindow({
    startAt,
    bookingOpenMinutesBefore: service.bookingOpenMinutesBefore,
    bookingCloseMinutesBefore: service.bookingCloseMinutesBefore,
  });

  const slotId = crypto.randomUUID();
  await insertSlot({
    database: ctx.database,
    slotId,
    organizationId,
    storeId: service.storeId,
    serviceId: service.id,
    startAt,
    endAt,
    capacity: body.capacity ?? service.capacity,
    staffLabel: normalizeOptionalText(body.staffLabel) ?? null,
    locationLabel: normalizeOptionalText(body.locationLabel) ?? null,
    bookingOpenAt: slotBookingWindow.bookingOpenAt,
    bookingCloseAt: slotBookingWindow.bookingCloseAt,
    publicStatus: body.publicStatus ?? SLOT_PUBLIC_STATUS.PUBLIC,
  });

  const slot = await getSlotById(ctx.database, slotId);
  return jsonResult(serializeSlot(slot as Record<string, unknown> | undefined));
};

/**
 * 予約が入っていない未来の open slot だけを、管理権限確認後に更新します。
 */
export const updateExistingSlot = async (
  ctx: BookingRouteContext,
  body: SlotUpdateBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const startAt = parseIsoDateOrNull(body.startAt);
  const endAt = parseIsoDateOrNull(body.endAt);
  if (!startAt || !endAt || startAt.getTime() >= endAt.getTime()) {
    return validationError('Invalid slot startAt/endAt.');
  }

  const slot = await findSlotForUpdate(ctx.database, body.slotId);
  if (!slot) {
    return notFound('Slot not found.');
  }

  if (isRequestedStoreMismatch(body.storeId, slot.storeId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageStoreScope({
    organizationId: slot.organizationId,
    storeId: slot.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  if (slot.status !== SLOT_STATUS.OPEN) {
    return conflict('Slot is not open.');
  }
  if (slot.reservedCount > 0) {
    return conflict('Slot with reservations cannot be updated.');
  }
  if (new Date(slot.startAt).getTime() <= Date.now()) {
    return conflict('Started slot cannot be updated.');
  }

  const service = await findServiceForSlot(ctx.database, slot.serviceId);
  if (
    !service ||
    service.organizationId !== slot.organizationId ||
    service.storeId !== slot.storeId
  ) {
    return notFound('Service not found.');
  }

  const slotBookingWindow = resolveSlotBookingWindow({
    startAt,
    bookingOpenMinutesBefore: service.bookingOpenMinutesBefore,
    bookingCloseMinutesBefore: service.bookingCloseMinutesBefore,
  });

  await updateSlot({
    database: ctx.database,
    slotId: slot.id,
    startAt,
    endAt,
    capacity: body.capacity ?? slot.capacity,
    staffLabel: normalizeOptionalText(body.staffLabel) ?? null,
    locationLabel: normalizeOptionalText(body.locationLabel) ?? null,
    bookingOpenAt: slotBookingWindow.bookingOpenAt,
    bookingCloseAt: slotBookingWindow.bookingCloseAt,
  });

  const updatedSlot = await getSlotById(ctx.database, slot.id);
  return jsonResult(serializeSlot(updatedSlot as Record<string, unknown> | undefined));
};

/**
 * 既存予約を残したまま、未来の open slot の公開予約上の表示だけを更新します。
 */
export const updateExistingSlotPublicStatus = async (
  ctx: BookingRouteContext,
  body: SlotPublicStatusUpdateBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const slot = await findSlotForUpdate(ctx.database, body.slotId);
  if (!slot) {
    return notFound('Slot not found.');
  }

  if (isRequestedStoreMismatch(body.storeId, slot.storeId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageStoreScope({
    organizationId: slot.organizationId,
    storeId: slot.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  if (slot.status !== SLOT_STATUS.OPEN) {
    return conflict('Slot is not open.');
  }
  if (new Date(slot.startAt).getTime() <= Date.now()) {
    return conflict('Started slot cannot be updated.');
  }

  await updateSlotPublicStatus({
    database: ctx.database,
    slotId: slot.id,
    publicStatus: body.publicStatus,
  });

  const updatedSlot = await getSlotById(ctx.database, slot.id);
  return jsonResult(serializeSlot(updatedSlot as Record<string, unknown> | undefined));
};

/**
 * staff が管理可能な slot を期間・service・status で絞り込んで返します。
 */
export const listStaffSlots = async (
  ctx: BookingRouteContext,
  query: SlotListQuery,
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

  const from = parseIsoDateOrNull(query.from);
  const to = parseIsoDateOrNull(query.to);
  if (!from || !to || from.getTime() > to.getTime()) {
    return validationError('Invalid from/to.');
  }

  const rows = await listSlots({
    database: ctx.database,
    organizationId,
    storeId: query.storeId,
    serviceId: query.serviceId,
    status: query.status,
    from,
    to,
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeSlot(row)));
};

/**
 * participant が所属する store のうち、現在予約可能な slot だけを返します。
 */
export const listParticipantAvailableSlots = async (
  ctx: BookingRouteContext,
  query: SlotAvailableQuery,
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

  if (query.storeId) {
    const scoped = await ctx.resolveRequestedStoreAccess({
      organizationId,
      storeId: query.storeId,
      userId: identity.userId,
    });
    if (!scoped || !scoped.access.effective.canUseParticipantBooking) {
      return forbidden();
    }
  }

  const participantRecords = await ctx.listParticipantRecordsForUser({
    organizationId,
    storeId: query.storeId,
    userId: identity.userId,
  });
  if (participantRecords.length === 0) {
    return forbidden();
  }
  const accessibleStoreIds = Array.from(
    new Set(participantRecords.map((participant) => participant.storeId)),
  );

  const from = parseIsoDateOrNull(query.from);
  const to = parseIsoDateOrNull(query.to);
  if (!from || !to || from.getTime() > to.getTime()) {
    return validationError('Invalid from/to.');
  }

  const rows = await listAvailableSlots({
    database: ctx.database,
    organizationId,
    storeId: query.storeId,
    serviceId: query.serviceId,
    accessibleStoreIds,
    from,
    to,
    now: new Date(),
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeSlot(row)));
};

/**
 * 管理権限を確認し、open slot とその確定予約をキャンセル状態へ遷移します。
 */
export const cancelExistingSlot = async (
  ctx: BookingRouteContext,
  body: SlotCancelBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const slot = await findSlotForCancel(ctx.database, body.slotId);
  if (!slot) {
    return notFound('Slot not found.');
  }

  if (isRequestedStoreMismatch(body.storeId, slot.storeId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageStoreScope({
    organizationId: slot.organizationId,
    storeId: slot.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  if (slot.status !== SLOT_STATUS.OPEN) {
    return conflict('Slot is not open.');
  }

  const cancelledBookings = await cancelSlotAndConfirmedBookings({
    database: ctx.database,
    slotId: slot.id,
    actorUserId: identity.userId,
    reason: body.reason,
  });
  await Promise.all(
    cancelledBookings.map((booking: CancelledSlotBooking) =>
      writeBookingAuditLog({
        database: ctx.database,
        bookingId: booking.id,
        organizationId: booking.organizationId,
        storeId: booking.storeId,
        actorUserId: identity.userId,
        action: BOOKING_AUDIT_ACTION.CANCELLED_BY_STAFF,
        metadata: {
          reason: body.reason ?? 'slot-canceled',
          slotId: slot.id,
        },
        headers,
      }),
    ),
  );

  return jsonResult({ ok: true });
};

/**
 * slot module から既定 timezone を公開します。
 */
export { DEFAULT_TIMEZONE };
