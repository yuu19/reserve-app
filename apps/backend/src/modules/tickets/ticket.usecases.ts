import {
  findParticipantByUserAndOrganization,
  resolveOrganizationId,
} from '../../booking/authorization.js';
import { TICKET_PURCHASE_METHOD, TICKET_PURCHASE_STATUS } from '../../booking/constants.js';
import { isRequestedClassroomMismatch } from '../shared/classroom-policy.js';
import {
  serializeTicketPack,
  serializeTicketPurchase,
  serializeTicketType,
} from '../shared/serializers.js';
import {
  conflict,
  forbidden,
  jsonResult,
  notFound,
  unauthorized,
  validationError,
  type JsonRouteResult,
} from '../shared/route-result.js';
import type { BookingRouteContext } from '../shared/route-context.js';
import {
  cancelTicketPurchase,
  countServicesByIds,
  expireActiveTicketPacks,
  findParticipantForTicketPackGrant,
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
} from './ticket.repository.js';
import {
  approveTicketPurchaseWithIssue,
  issueTicketPackWithLedger,
  resolveEndDate,
} from './ticket.state.js';
import type {
  OrgQuery,
  TicketPackGrantBody,
  TicketPackMineQuery,
  TicketPurchaseApproveBody,
  TicketPurchaseCancelBody,
  TicketPurchaseCreateBody,
  TicketPurchaseListQuery,
  TicketPurchaseMineQuery,
  TicketPurchaseRejectBody,
  TicketTypeCreateBody,
  TicketTypeListQuery,
} from './ticket.schemas.js';

/**
 * Stripe 経由の ticket purchase が未実装であることを API 応答に使う固定文言です。
 */
export const TICKET_STRIPE_PURCHASE_UNAVAILABLE_MESSAGE =
  'Ticket purchase Stripe payment is currently unavailable.';

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

  const premiumGate = await ctx.requireOrganizationPremiumFeature(organizationId);
  if (!premiumGate.allowed) {
    return jsonResult(premiumGate.body, premiumGate.status);
  }

  if (body.serviceIds && body.serviceIds.length > 0) {
    const serviceCount = await countServicesByIds({
      database: ctx.database,
      organizationId,
      classroomId: classroomContext.classroomId,
      serviceIds: body.serviceIds,
    });

    if (serviceCount !== body.serviceIds.length) {
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
    serviceIds: body.serviceIds,
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

  const premiumGate = await ctx.requireOrganizationPremiumFeature(purchase.organizationId);
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

  const premiumGate = await ctx.requireOrganizationPremiumFeature(purchase.organizationId);
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

  const premiumGate = await ctx.requireOrganizationPremiumFeature(organizationId);
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
    actorUserId: identity.userId,
    reason: 'staff-grant',
  });
  return jsonResult(issued.ticketPack);
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
