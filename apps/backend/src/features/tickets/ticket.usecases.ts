import {
  findParticipantByUserAndOrganization,
  resolveOrganizationId,
} from '../../domain/booking/authorization.js';
import { TICKET_PURCHASE_METHOD, TICKET_PURCHASE_STATUS } from '../../domain/booking/constants.js';
import { isRequestedClassroomMismatch } from '../../shared/classroom-policy.js';
import { parseIsoDateOrNull } from '../../shared/date.js';
import {
  parseTicketServiceIds,
  serializeTicketPack,
  serializeTicketPurchase,
  serializeTicketType,
  type TicketServiceScope,
} from '../../shared/serializers.js';
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
import { RESERVE_APP_ENTITLEMENTS } from '../billing/policies/reserve-app-billing-policy.js';
import {
  cancelTicketPurchase,
  countServicesByIds,
  expireActiveTicketPacks,
  findParticipantForTicketPackGrant,
  findTicketPackForAdjustment,
  findTicketPurchaseScope,
  findTicketTypeForPurchase,
  findTicketTypeForTicketPackGrant,
  getTicketPurchaseById,
  getTicketTypeById,
  insertTicketPurchase,
  insertTicketType,
  listPurchasableTicketTypes,
  listTicketPacks,
  listTicketPurchases,
  listTicketTypes,
  rejectTicketPurchase,
  updateTicketType,
} from './ticket.repository.js';
import {
  adjustTicketPackWithLedger,
  approveTicketPurchaseWithIssue,
  issueTicketPackWithLedger,
  resolveEndDate,
} from './ticket.state.js';
import type {
  OrgQuery,
  TicketPackAdjustBody,
  TicketPackGrantBody,
  TicketPackListQuery,
  TicketPackMineQuery,
  TicketPurchaseApproveBody,
  TicketPurchaseCancelBody,
  TicketPurchaseCreateBody,
  TicketPurchaseListQuery,
  TicketPurchaseMineQuery,
  TicketPurchaseRejectBody,
  TicketTypeCreateBody,
  TicketTypeListQuery,
  TicketTypeUpdateBody,
} from './ticket.schemas.js';

/**
 * Stripe 経由の ticket purchase が未実装であることを API 応答に使う固定文言です。
 */
export const TICKET_STRIPE_PURCHASE_UNAVAILABLE_MESSAGE =
  'Ticket purchase Stripe payment is currently unavailable.';

const resolveTicketServiceScopeInput = ({
  serviceScope,
  serviceIds,
}: {
  serviceScope?: TicketServiceScope;
  serviceIds?: string[];
}): { serviceScope: TicketServiceScope; serviceIds: string[] } => {
  if (serviceScope === 'all') {
    return { serviceScope, serviceIds: [] };
  }

  if (serviceScope === 'specific') {
    return { serviceScope, serviceIds: serviceIds ?? [] };
  }

  const normalizedServiceIds = serviceIds ?? [];
  return normalizedServiceIds.length > 0
    ? { serviceScope: 'specific', serviceIds: normalizedServiceIds }
    : { serviceScope: 'all', serviceIds: [] };
};

const resolveTicketServiceScopeUpdate = ({
  serviceScope,
  serviceIds,
}: {
  serviceScope?: TicketServiceScope;
  serviceIds?: string[];
}): { serviceScope: TicketServiceScope; serviceIds: string[] } | undefined => {
  if (serviceScope === undefined && serviceIds === undefined) {
    return undefined;
  }
  return resolveTicketServiceScopeInput({ serviceScope, serviceIds });
};

const ensureSpecificServiceIds = ({
  serviceScope,
  serviceIds,
}: {
  serviceScope: TicketServiceScope;
  serviceIds: string[];
}): JsonRouteResult | null => {
  if (serviceScope === 'specific' && serviceIds.length === 0) {
    return validationError('serviceIds is required when serviceScope is specific.');
  }
  return null;
};

/**
 * classroom 管理権限と premium を確認し、必要なら serviceIds 所属も検証して ticket type を作成します。
 */
export const createTicketType = async (
  ctx: BookingRouteContext,
  body: TicketTypeCreateBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
  if (!organizationId) {
    return validationError('organizationId is required.');
  }

  const classroomContext = await ctx.resolveRequestedClassroomContext({
    organizationId,
    classroomId: body.classroomId,
  });
  if (!classroomContext) {
    return notFound('Classroom not found.');
  }

  const hasAccess = await ctx.canManageClassroomScope({
    organizationId,
    classroomId: body.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const premiumGate = await ctx.requireOrganizationEntitlement({
    organizationId,
    key: RESERVE_APP_ENTITLEMENTS.TICKET_ENABLED,
  });
  if (!premiumGate.allowed) {
    return jsonResult(premiumGate.body, premiumGate.status);
  }

  const serviceScope = resolveTicketServiceScopeInput(body);
  const serviceScopeError = ensureSpecificServiceIds(serviceScope);
  if (serviceScopeError) {
    return serviceScopeError;
  }

  if (serviceScope.serviceScope === 'specific') {
    const serviceCount = await countServicesByIds({
      database: ctx.database,
      organizationId,
      classroomId: classroomContext.classroomId,
      serviceIds: serviceScope.serviceIds,
    });

    if (serviceCount !== serviceScope.serviceIds.length) {
      return validationError('serviceIds includes unknown service.');
    }
  }

  const ticketTypeId = crypto.randomUUID();
  await insertTicketType({
    database: ctx.database,
    ticketTypeId,
    organizationId,
    classroomId: classroomContext.classroomId,
    name: body.name,
    serviceIds: serviceScope.serviceIds,
    totalCount: body.totalCount,
    expiresInDays: body.expiresInDays,
    isActive: body.isActive,
    isForSale: body.isForSale,
    stripePriceId: body.stripePriceId,
  });

  const ticketType = await getTicketTypeById(ctx.database, ticketTypeId);
  return jsonResult(serializeTicketType(ticketType as Record<string, unknown> | undefined));
};

/**
 * staff が既存 ticket type の future grant/purchase 向け設定を更新します。
 */
export const updateExistingTicketType = async (
  ctx: BookingRouteContext,
  body: TicketTypeUpdateBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
  if (!organizationId) {
    return validationError('organizationId is required.');
  }

  const ticketType = await getTicketTypeById(ctx.database, body.ticketTypeId);
  if (!ticketType || ticketType.organizationId !== organizationId) {
    return notFound('Ticket type not found.');
  }
  if (isRequestedClassroomMismatch(body.classroomId, ticketType.classroomId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageClassroomScope({
    organizationId,
    classroomId: ticketType.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const premiumGate = await ctx.requireOrganizationEntitlement({
    organizationId,
    key: RESERVE_APP_ENTITLEMENTS.TICKET_ENABLED,
  });
  if (!premiumGate.allowed) {
    return jsonResult(premiumGate.body, premiumGate.status);
  }

  const serviceScopeUpdate = resolveTicketServiceScopeUpdate(body);
  if (serviceScopeUpdate) {
    const serviceScopeError = ensureSpecificServiceIds(serviceScopeUpdate);
    if (serviceScopeError) {
      return serviceScopeError;
    }
  }

  if (serviceScopeUpdate?.serviceScope === 'specific') {
    const serviceCount = await countServicesByIds({
      database: ctx.database,
      organizationId,
      classroomId: ticketType.classroomId,
      serviceIds: serviceScopeUpdate.serviceIds,
    });

    if (serviceCount !== serviceScopeUpdate.serviceIds.length) {
      return validationError('serviceIds includes unknown service.');
    }
  }

  const updated = await updateTicketType({
    database: ctx.database,
    ticketTypeId: ticketType.id,
    name: body.name,
    serviceIds: serviceScopeUpdate?.serviceIds,
    totalCount: body.totalCount,
    expiresInDays: body.expiresInDays,
    isActive: body.isActive,
    isForSale: body.isForSale,
  });
  if (!updated) {
    return notFound('Ticket type not found.');
  }

  const updatedTicketType = await getTicketTypeById(ctx.database, ticketType.id);
  return jsonResult(serializeTicketType(updatedTicketType as Record<string, unknown> | undefined));
};

/**
 * staff が閲覧できる ticket type を scope と active 条件で一覧します。
 */
export const listManageableTicketTypes = async (
  ctx: BookingRouteContext,
  query: TicketTypeListQuery,
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

  const hasAccess = await ctx.canReadTicketTypesScope({
    organizationId,
    classroomId: query.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const rows = await listTicketTypes({
    database: ctx.database,
    organizationId,
    classroomId: query.classroomId,
    isActive: query.isActive,
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeTicketType(row)));
};

/**
 * participant が所属 classroom で購入可能な ticket type だけを返します。
 */
export const listPurchasableTicketTypeOptions = async (
  ctx: BookingRouteContext,
  query: OrgQuery,
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

  if (query.classroomId) {
    const scoped = await ctx.resolveRequestedClassroomAccess({
      organizationId,
      classroomId: query.classroomId,
      userId: identity.userId,
    });
    if (!scoped || !scoped.access.effective.canUseParticipantBooking) {
      return forbidden();
    }
  }

  const participantRecords = await ctx.listParticipantRecordsForUser({
    organizationId,
    classroomId: query.classroomId,
    userId: identity.userId,
  });
  if (participantRecords.length === 0) {
    return forbidden();
  }
  const accessibleClassroomIds = Array.from(
    new Set(participantRecords.map((participant) => participant.classroomId)),
  );

  const rows = await listPurchasableTicketTypes({
    database: ctx.database,
    organizationId,
    classroomId: query.classroomId,
    accessibleClassroomIds,
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeTicketType(row)));
};

/**
 * participant の ticket purchase を作成します。
 *
 * @remarks
 * Stripe 決済は未提供のため、現時点では現地支払い・銀行振込など承認待ち purchase の作成に限定します。
 */
export const createTicketPurchase = async (
  ctx: BookingRouteContext,
  body: TicketPurchaseCreateBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
  if (!organizationId) {
    return validationError('organizationId is required.');
  }

  if (body.classroomId) {
    const scoped = await ctx.resolveRequestedClassroomAccess({
      organizationId,
      classroomId: body.classroomId,
      userId: identity.userId,
    });
    if (!scoped || !scoped.access.effective.canUseParticipantBooking) {
      return forbidden();
    }
  }

  if (body.paymentMethod === TICKET_PURCHASE_METHOD.STRIPE) {
    return validationError(TICKET_STRIPE_PURCHASE_UNAVAILABLE_MESSAGE);
  }

  const ticketType = await findTicketTypeForPurchase({
    database: ctx.database,
    ticketTypeId: body.ticketTypeId,
    organizationId,
    classroomId: body.classroomId,
  });
  if (!ticketType) {
    return notFound('Ticket type not found.');
  }
  const participant = await findParticipantByUserAndOrganization({
    database: ctx.database,
    organizationId,
    classroomId: ticketType.classroomId,
    userId: identity.userId,
  });
  if (!participant) {
    return forbidden();
  }
  if (ticketType.classroomId !== participant.classroomId) {
    return forbidden();
  }
  if (!ticketType.isActive || !ticketType.isForSale) {
    return conflict('Ticket type is not purchasable.');
  }

  const purchaseId = crypto.randomUUID();
  await insertTicketPurchase({
    database: ctx.database,
    purchaseId,
    organizationId,
    classroomId: ticketType.classroomId,
    participantId: participant.id,
    ticketTypeId: ticketType.id,
    serviceIds: parseTicketServiceIds(ticketType.serviceIdsJson),
    paymentMethod: body.paymentMethod,
  });

  const purchase = await getTicketPurchaseById(ctx.database, purchaseId);

  return jsonResult({
    ...serializeTicketPurchase(purchase as Record<string, unknown> | undefined),
    checkoutUrl: null,
  });
};

/**
 * participant 自身の ticket purchase を一覧します。
 */
export const listMyTicketPurchases = async (
  ctx: BookingRouteContext,
  query: TicketPurchaseMineQuery,
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

  const rows = await listTicketPurchases({
    database: ctx.database,
    organizationId,
    classroomId: query.classroomId,
    participantIds,
    status: query.status,
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeTicketPurchase(row)));
};

/**
 * staff が管理権限を持つ ticket purchase を条件付きで一覧します。
 */
export const listStaffTicketPurchases = async (
  ctx: BookingRouteContext,
  query: TicketPurchaseListQuery,
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

  const hasAccess = await ctx.canManageParticipantsScope({
    organizationId,
    classroomId: query.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const rows = await listTicketPurchases({
    database: ctx.database,
    organizationId,
    classroomId: query.classroomId,
    participantId: query.participantId,
    paymentMethod: query.paymentMethod,
    status: query.status,
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeTicketPurchase(row)));
};

/**
 * staff が承認待ち ticket purchase を承認し、ticket pack を発行します。
 */
export const approveTicketPurchase = async (
  ctx: BookingRouteContext,
  body: TicketPurchaseApproveBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const purchase = await findTicketPurchaseScope(ctx.database, body.purchaseId);
  if (!purchase) {
    return notFound('Ticket purchase not found.');
  }

  if (isRequestedClassroomMismatch(body.classroomId, purchase.classroomId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageParticipantsScope({
    organizationId: purchase.organizationId,
    classroomId: purchase.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const premiumGate = await ctx.requireOrganizationEntitlement({
    organizationId: purchase.organizationId,
    key: RESERVE_APP_ENTITLEMENTS.TICKET_ENABLED,
  });
  if (!premiumGate.allowed) {
    return jsonResult(premiumGate.body, premiumGate.status);
  }

  const result = await approveTicketPurchaseWithIssue({
    database: ctx.database,
    purchaseId: body.purchaseId,
    actorUserId: identity.userId,
    actorReason: 'purchase-approved-by-staff',
  });
  if (result.kind === 'not_found') {
    return notFound('Ticket purchase not found.');
  }
  if (result.kind === 'ticket_type_not_found') {
    return notFound('Ticket type not found.');
  }
  if (result.kind === 'already_approved' || result.kind === 'invalid_status') {
    return conflict('Only pending approval purchase can be approved.');
  }

  return jsonResult({
    purchase: result.purchase,
    ticketPack: result.ticketPack,
  });
};

/**
 * staff が承認待ち ticket purchase を却下します。
 */
export const rejectExistingTicketPurchase = async (
  ctx: BookingRouteContext,
  body: TicketPurchaseRejectBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const purchase = await findTicketPurchaseScope(ctx.database, body.purchaseId);
  if (!purchase) {
    return notFound('Ticket purchase not found.');
  }

  if (isRequestedClassroomMismatch(body.classroomId, purchase.classroomId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageParticipantsScope({
    organizationId: purchase.organizationId,
    classroomId: purchase.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  if (purchase.status !== TICKET_PURCHASE_STATUS.PENDING_APPROVAL) {
    return conflict('Only pending approval purchase can be rejected.');
  }

  const premiumGate = await ctx.requireOrganizationEntitlement({
    organizationId: purchase.organizationId,
    key: RESERVE_APP_ENTITLEMENTS.TICKET_ENABLED,
  });
  if (!premiumGate.allowed) {
    return jsonResult(premiumGate.body, premiumGate.status);
  }

  const updated = await rejectTicketPurchase({
    database: ctx.database,
    purchaseId: purchase.id,
    actorUserId: identity.userId,
    reason: body.reason,
  });
  if (!updated) {
    return conflict('Only pending approval purchase can be rejected.');
  }

  const rows = await getTicketPurchaseById(ctx.database, purchase.id);
  return jsonResult(serializeTicketPurchase(rows as Record<string, unknown> | undefined));
};

/**
 * participant が自身の承認待ちまたは支払い待ち ticket purchase を取り消します。
 */
export const cancelExistingTicketPurchase = async (
  ctx: BookingRouteContext,
  body: TicketPurchaseCancelBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const purchase = await findTicketPurchaseScope(ctx.database, body.purchaseId);
  if (!purchase) {
    return notFound('Ticket purchase not found.');
  }

  if (isRequestedClassroomMismatch(body.classroomId, purchase.classroomId)) {
    return forbidden();
  }

  const participant = await findParticipantByUserAndOrganization({
    database: ctx.database,
    organizationId: purchase.organizationId,
    classroomId: body.classroomId ?? purchase.classroomId,
    userId: identity.userId,
  });
  if (!participant || participant.id !== purchase.participantId) {
    return forbidden();
  }

  if (
    purchase.status !== TICKET_PURCHASE_STATUS.PENDING_PAYMENT &&
    purchase.status !== TICKET_PURCHASE_STATUS.PENDING_APPROVAL
  ) {
    return conflict('Purchase cannot be canceled.');
  }

  await cancelTicketPurchase({
    database: ctx.database,
    purchaseId: purchase.id,
  });

  const row = await getTicketPurchaseById(ctx.database, purchase.id);
  return jsonResult(serializeTicketPurchase(row as Record<string, unknown> | undefined));
};

/**
 * staff が participant に ticket pack を手動付与し、ledger を記録します。
 */
export const grantTicketPack = async (
  ctx: BookingRouteContext,
  body: TicketPackGrantBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
  if (!organizationId) {
    return validationError('organizationId is required.');
  }

  const hasAccess = await ctx.canManageParticipantsScope({
    organizationId,
    classroomId: body.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const premiumGate = await ctx.requireOrganizationEntitlement({
    organizationId,
    key: RESERVE_APP_ENTITLEMENTS.TICKET_ENABLED,
  });
  if (!premiumGate.allowed) {
    return jsonResult(premiumGate.body, premiumGate.status);
  }

  const participant = await findParticipantForTicketPackGrant({
    database: ctx.database,
    organizationId,
    classroomId: body.classroomId,
    participantId: body.participantId,
  });
  if (!participant) {
    return notFound('Participant not found.');
  }

  const ticketType = await findTicketTypeForTicketPackGrant({
    database: ctx.database,
    organizationId,
    classroomId: body.classroomId,
    ticketTypeId: body.ticketTypeId,
  });
  if (!ticketType) {
    return notFound('Ticket type not found.');
  }
  if (participant.classroomId !== ticketType.classroomId) {
    return validationError('Participant and ticket type must belong to the same classroom.');
  }
  if (!ticketType.isActive) {
    return conflict('Ticket type is inactive.');
  }

  const count = body.count ?? ticketType.totalCount;
  const expiresAt = resolveEndDate(ticketType.expiresInDays, body.expiresAt);
  if (body.expiresAt && !expiresAt) {
    return validationError('Invalid expiresAt.');
  }

  const issued = await issueTicketPackWithLedger({
    database: ctx.database,
    organizationId,
    classroomId: participant.classroomId,
    participantId: participant.id,
    ticketTypeId: ticketType.id,
    count,
    expiresAt,
    serviceIds: parseTicketServiceIds(ticketType.serviceIdsJson),
    actorUserId: identity.userId,
    reason: 'staff-grant',
  });
  return jsonResult(issued.ticketPack);
};

/**
 * staff が participant の発行済み ticket pack を一覧します。
 */
export const listStaffTicketPacks = async (
  ctx: BookingRouteContext,
  query: TicketPackListQuery,
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

  const hasAccess = await ctx.canManageParticipantsScope({
    organizationId,
    classroomId: query.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const participant = await findParticipantForTicketPackGrant({
    database: ctx.database,
    organizationId,
    classroomId: query.classroomId,
    participantId: query.participantId,
  });
  if (!participant) {
    return notFound('Participant not found.');
  }

  await expireActiveTicketPacks({
    database: ctx.database,
    organizationId,
    classroomId: participant.classroomId,
    participantIds: [participant.id],
    now: new Date(),
  });

  const rows = await listTicketPacks({
    database: ctx.database,
    organizationId,
    classroomId: participant.classroomId,
    participantIds: [participant.id],
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeTicketPack(row)));
};

/**
 * staff が発行済み ticket pack の残数や期限を監査ログ付きで調整します。
 */
export const adjustExistingTicketPack = async (
  ctx: BookingRouteContext,
  body: TicketPackAdjustBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const ticketPack = await findTicketPackForAdjustment(ctx.database, body.ticketPackId);
  if (!ticketPack) {
    return notFound('Ticket pack not found.');
  }
  if (isRequestedClassroomMismatch(body.classroomId, ticketPack.classroomId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageParticipantsScope({
    organizationId: ticketPack.organizationId,
    classroomId: ticketPack.classroomId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const premiumGate = await ctx.requireOrganizationEntitlement({
    organizationId: ticketPack.organizationId,
    key: RESERVE_APP_ENTITLEMENTS.TICKET_ENABLED,
  });
  if (!premiumGate.allowed) {
    return jsonResult(premiumGate.body, premiumGate.status);
  }

  if (
    body.remainingCount !== undefined &&
    (body.remainingCount < 0 || body.remainingCount > ticketPack.initialCount)
  ) {
    return validationError('remainingCount must be between 0 and initialCount.');
  }

  const nextRemainingCount = body.remainingCount ?? ticketPack.remainingCount;
  const nextExpiresAt =
    body.expiresAt === undefined
      ? ticketPack.expiresAt
      : body.expiresAt === null
        ? null
        : parseIsoDateOrNull(body.expiresAt);
  if (body.expiresAt && !nextExpiresAt) {
    return validationError('Invalid expiresAt.');
  }

  const currentExpiresAtTime = ticketPack.expiresAt ? ticketPack.expiresAt.getTime() : null;
  const nextExpiresAtTime = nextExpiresAt ? nextExpiresAt.getTime() : null;
  if (
    nextRemainingCount === ticketPack.remainingCount &&
    nextExpiresAtTime === currentExpiresAtTime
  ) {
    return conflict('Ticket pack adjustment has no changes.');
  }

  const result = await adjustTicketPackWithLedger({
    database: ctx.database,
    ticketPackId: ticketPack.id,
    remainingCount: nextRemainingCount,
    expiresAt: nextExpiresAt,
    actorUserId: identity.userId,
    reason: body.reason,
  });
  if (result.kind === 'not_found') {
    return notFound('Ticket pack not found.');
  }

  return jsonResult(result.ticketPack);
};

/**
 * participant 自身の ticket pack を一覧し、期限切れ pack を取得前に expired へ更新します。
 */
export const listMyTicketPacks = async (
  ctx: BookingRouteContext,
  query: TicketPackMineQuery,
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

  await expireActiveTicketPacks({
    database: ctx.database,
    organizationId,
    classroomId: query.classroomId,
    participantIds,
    now: new Date(),
  });

  const rows = await listTicketPacks({
    database: ctx.database,
    organizationId,
    classroomId: query.classroomId,
    participantIds,
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeTicketPack(row)));
};
