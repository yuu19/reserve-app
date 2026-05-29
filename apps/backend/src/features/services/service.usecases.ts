import { resolveOrganizationId } from '../../domain/booking/authorization.js';
import { DEFAULT_TIMEZONE } from '../../domain/booking/constants.js';
import { isSupportedTimezone } from '../../domain/booking/recurring.js';
import { isRequestedStoreMismatch } from '../../shared/store-policy.js';
import { assertSupportedTimezone, toIsoDate } from '../../shared/date.js';
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
  archiveService,
  findServiceForUpdate,
  findServiceScope,
  getServiceById,
  insertService,
  listServices,
  updateService,
} from './service.repository.js';
import type {
  ServiceArchiveBody,
  ServiceCreateBody,
  ServiceListQuery,
  ServiceUpdateBody,
} from './service.schemas.js';

const normalizeServiceDescription = (
  value: string | null | undefined,
): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const serviceConfigurationRequiresPremium = ({
  bookingPolicy,
  requiresTicket,
}: {
  bookingPolicy: 'instant' | 'approval' | string;
  requiresTicket: boolean;
}) => {
  return bookingPolicy === 'approval' || requiresTicket;
};

const requireServiceConfigurationEntitlements = async ({
  ctx,
  organizationId,
  bookingPolicy,
  requiresTicket,
}: {
  ctx: BookingRouteContext;
  organizationId: string;
  bookingPolicy: 'instant' | 'approval' | string;
  requiresTicket: boolean;
}) => {
  const requiredKeys: string[] = [];
  if (bookingPolicy === 'approval') {
    requiredKeys.push(RESERVE_APP_ENTITLEMENTS.BOOKING_APPROVAL);
  }
  if (requiresTicket) {
    requiredKeys.push(RESERVE_APP_ENTITLEMENTS.TICKET_ENABLED);
  }

  for (const key of requiredKeys) {
    const gate = await ctx.requireOrganizationEntitlement({
      organizationId,
      key,
    });
    if (!gate.allowed) {
      return gate;
    }
  }

  return { allowed: true as const };
};

const serializeService = (row: Record<string, unknown> | undefined) => ({
  ...row,
  createdAt: toIsoDate(row?.createdAt),
  updatedAt: toIsoDate(row?.updatedAt),
});

/**
 * store 管理権限を確認し、premium が必要な設定を検証して service を作成します。
 */
export const createService = async (
  ctx: BookingRouteContext,
  body: ServiceCreateBody,
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

  const storeContext = await ctx.resolveRequestedStoreContext({
    organizationId,
    storeId: body.storeId,
  });
  if (!storeContext) {
    return notFound('Store not found.');
  }

  const timezone = assertSupportedTimezone(body.timezone);
  if (!timezone) {
    return validationError(`Only ${DEFAULT_TIMEZONE} is supported in MVP.`);
  }

  const hasAccess = await ctx.canManageStoreScope({
    organizationId,
    storeId: body.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  if (
    serviceConfigurationRequiresPremium({
      bookingPolicy: body.bookingPolicy ?? 'instant',
      requiresTicket: body.requiresTicket ?? false,
    })
  ) {
    const premiumGate = await requireServiceConfigurationEntitlements({
      ctx,
      organizationId,
      bookingPolicy: body.bookingPolicy ?? 'instant',
      requiresTicket: body.requiresTicket ?? false,
    });
    if (!premiumGate.allowed) {
      return jsonResult(premiumGate.body, premiumGate.status);
    }
  }

  const createdId = crypto.randomUUID();
  await insertService({
    database: ctx.database,
    createdId,
    organizationId,
    storeId: storeContext.storeId,
    name: body.name,
    description: normalizeServiceDescription(body.description) ?? null,
    kind: body.kind,
    imageUrl: body.imageUrl,
    durationMinutes: body.durationMinutes,
    capacity: body.capacity,
    bookingOpenMinutesBefore: body.bookingOpenMinutesBefore,
    bookingCloseMinutesBefore: body.bookingCloseMinutesBefore,
    cancellationDeadlineMinutes: body.cancellationDeadlineMinutes,
    timezone,
    bookingPolicy: body.bookingPolicy ?? 'instant',
    requiresTicket: body.requiresTicket ?? false,
    isActive: body.isActive ?? true,
  });

  const service = await getServiceById(ctx.database, createdId);
  return jsonResult(serializeService(service as Record<string, unknown> | undefined));
};

/**
 * service 管理画面向けに、閲覧権限のある service 一覧を返します。
 */
export const listManageableServices = async (
  ctx: BookingRouteContext,
  query: ServiceListQuery,
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

  const hasAccess = await ctx.canReadServicesScope({
    organizationId,
    storeId: query.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  const rows = await listServices({
    database: ctx.database,
    organizationId,
    storeId: query.storeId,
    includeArchived: query.includeArchived,
  });

  return jsonResult(rows.map((row: Record<string, unknown>) => serializeService(row)));
};

/**
 * service の所属 scope と管理権限を確認し、許可されたフィールドだけを部分更新します。
 */
export const updateExistingService = async (
  ctx: BookingRouteContext,
  body: ServiceUpdateBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const current = await findServiceForUpdate(ctx.database, body.serviceId);
  if (!current) {
    return notFound('Service not found.');
  }

  if (isRequestedStoreMismatch(body.storeId, current.storeId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageStoreScope({
    organizationId: current.organizationId,
    storeId: current.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  if (
    serviceConfigurationRequiresPremium({
      bookingPolicy: body.bookingPolicy ?? current.bookingPolicy,
      requiresTicket: body.requiresTicket ?? current.requiresTicket,
    })
  ) {
    const premiumGate = await requireServiceConfigurationEntitlements({
      ctx,
      organizationId: current.organizationId,
      bookingPolicy: body.bookingPolicy ?? current.bookingPolicy,
      requiresTicket: body.requiresTicket ?? current.requiresTicket,
    });
    if (!premiumGate.allowed) {
      return jsonResult(premiumGate.body, premiumGate.status);
    }
  }

  if (body.timezone && !isSupportedTimezone(body.timezone)) {
    return validationError(`Only ${DEFAULT_TIMEZONE} is supported in MVP.`);
  }

  await updateService({
    database: ctx.database,
    serviceId: body.serviceId,
    changes: {
      name: body.name,
      description:
        body.description !== undefined ? normalizeServiceDescription(body.description) : undefined,
      kind: body.kind,
      imageUrl: body.imageUrl,
      durationMinutes: body.durationMinutes,
      capacity: body.capacity,
      bookingOpenMinutesBefore: body.bookingOpenMinutesBefore,
      bookingCloseMinutesBefore: body.bookingCloseMinutesBefore,
      cancellationDeadlineMinutes: body.cancellationDeadlineMinutes,
      timezone: body.timezone,
      bookingPolicy: body.bookingPolicy,
      requiresTicket: body.requiresTicket,
      isActive: body.isActive,
    },
  });

  const service = await getServiceById(ctx.database, body.serviceId);
  return jsonResult(serializeService(service as Record<string, unknown> | undefined));
};

/**
 * store 管理権限を確認し、service を inactive として archive します。
 */
export const archiveExistingService = async (
  ctx: BookingRouteContext,
  body: ServiceArchiveBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const service = await findServiceScope(ctx.database, body.serviceId);
  if (!service) {
    return notFound('Service not found.');
  }

  if (isRequestedStoreMismatch(body.storeId, service.storeId)) {
    return forbidden();
  }

  const hasAccess = await ctx.canManageStoreScope({
    organizationId: service.organizationId,
    storeId: service.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  await archiveService(ctx.database, service.id);
  return jsonResult({ ok: true });
};
