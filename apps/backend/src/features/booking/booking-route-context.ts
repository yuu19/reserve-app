import { and, eq } from 'drizzle-orm';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import {
  findParticipantsByUserAndOrganization,
  getSessionIdentity,
  hasAdminOrOwnerAccess,
  readOrganizationEntitlementGate,
  readOrganizationPremiumFeatureGate,
  resolveOrganizationStoreAccess,
  resolveOrganizationStoreContext,
  type SessionIdentity,
} from '../../domain/booking/authorization.js';
import * as dbSchema from '../../infra/db/schema.js';
import type { ServiceImageUploadService } from '../../infra/storage/service-image-upload-service.js';
import type { ScopedStoreRouteParams } from '../../shared/scoped-store-route.js';
import { readBillingApiOrganizationFeatureEntitlement } from '../billing/billing-api-summary.js';

/**
 * Better Auth middleware が route context に保存する user/session 変数の型です。
 */
export type AuthRouteBindings = {
  Variables: {
    user: Record<string, unknown> | null;
    session: Record<string, unknown> | null;
  };
};

/**
 * 予約系 route 登録に注入する外部依存をまとめます。
 */
export type BookingRouteDeps = {
  authRoutes: OpenAPIHono<AuthRouteBindings>;
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  serviceImageUploadService?: ServiceImageUploadService | null;
};

/**
 * 予約系 usecase が共有する認証・認可・premium 判定の境界です。
 */
export type BookingRouteContext = BookingRouteDeps & {
  requireIdentity: (headers: Headers) => Promise<SessionIdentity | null>;
  resolveScopedStoreContext: (params: ScopedStoreRouteParams) => Promise<{
    organizationId: string;
    organizationSlug: string;
    organizationName: string;
    storeId: string;
    storeSlug: string;
    storeName: string;
  } | null>;
  resolveRequestedStoreContext: (input: {
    organizationId: string;
    storeId?: string | null;
  }) => Promise<{
    organizationId: string;
    organizationSlug: string;
    organizationName: string;
    storeId: string;
    storeSlug: string;
    storeName: string;
  } | null>;
  resolveRequestedStoreAccess: (input: {
    organizationId: string;
    storeId?: string | null;
    userId: string;
  }) => Promise<{
    context: NonNullable<Awaited<ReturnType<BookingRouteContext['resolveRequestedStoreContext']>>>;
    access: Awaited<ReturnType<typeof resolveOrganizationStoreAccess>>;
  } | null>;
  canManageStoreScope: (input: {
    organizationId: string;
    storeId?: string | null;
    userId: string;
  }) => Promise<boolean>;
  canManageBookingsScope: (input: {
    organizationId: string;
    storeId?: string | null;
    userId: string;
  }) => Promise<boolean>;
  canManageParticipantsScope: (input: {
    organizationId: string;
    storeId?: string | null;
    userId: string;
  }) => Promise<boolean>;
  canReadServicesScope: (input: {
    organizationId: string;
    storeId?: string | null;
    userId: string;
  }) => Promise<boolean>;
  canReadTicketTypesScope: (input: {
    organizationId: string;
    storeId?: string | null;
    userId: string;
  }) => Promise<boolean>;
  listParticipantRecordsForUser: (input: {
    organizationId: string;
    storeId?: string | null;
    userId: string;
  }) => Promise<Array<{ id: string; storeId: string }>>;
  requireOrganizationPremiumFeature: (
    organizationId: string,
  ) => ReturnType<typeof readOrganizationPremiumFeatureGate>;
  requireOrganizationEntitlement: (input: {
    organizationId: string;
    key: string;
  }) => ReturnType<typeof readOrganizationEntitlementGate>;
};

export type ScopedStoreContext = NonNullable<
  Awaited<ReturnType<BookingRouteContext['resolveScopedStoreContext']>>
>;

/**
 * Hono route と usecase の間で共有する予約系コンテキストを生成します。
 *
 * @remarks
 * organization 全体の操作は owner/admin 権限、store 指定の操作は店舗ごとの有効権限で判定します。
 */
export const createBookingRouteContext = (deps: BookingRouteDeps): BookingRouteContext => {
  const { auth, database, env } = deps;

  const requireIdentity = async (headers: Headers) => {
    return getSessionIdentity(auth, headers);
  };

  const resolveScopedStoreContext: BookingRouteContext['resolveScopedStoreContext'] = async ({
    orgSlug,
    storeSlug,
  }) => {
    return resolveOrganizationStoreContext({
      database,
      organizationSlug: orgSlug,
      storeSlug,
    });
  };

  const resolveRequestedStoreContext: BookingRouteContext['resolveRequestedStoreContext'] = async ({
    organizationId,
    storeId,
  }) => {
    if (!storeId) {
      return resolveOrganizationStoreContext({
        database,
        organizationId,
      });
    }

    const rows = await database
      .select({
        organizationId: dbSchema.organization.id,
        organizationSlug: dbSchema.organization.slug,
        organizationName: dbSchema.organization.name,
        storeId: dbSchema.store.id,
        storeSlug: dbSchema.store.slug,
        storeName: dbSchema.store.name,
      })
      .from(dbSchema.store)
      .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.store.organizationId))
      .where(and(eq(dbSchema.store.organizationId, organizationId), eq(dbSchema.store.id, storeId)))
      .limit(1);

    return rows[0] ?? null;
  };

  const resolveRequestedStoreAccess: BookingRouteContext['resolveRequestedStoreAccess'] = async ({
    organizationId,
    storeId,
    userId,
  }) => {
    const context = await resolveRequestedStoreContext({
      organizationId,
      storeId,
    });
    if (!context) {
      return null;
    }

    const access = await resolveOrganizationStoreAccess({
      database,
      userId,
      context,
    });
    return {
      context,
      access,
    };
  };

  const canManageStoreScope: BookingRouteContext['canManageStoreScope'] = async ({
    organizationId,
    storeId,
    userId,
  }) => {
    if (!storeId) {
      return hasAdminOrOwnerAccess({
        database,
        organizationId,
        userId,
      });
    }

    const scoped = await resolveRequestedStoreAccess({
      organizationId,
      storeId,
      userId,
    });
    return scoped?.access.effective.canManageStore ?? false;
  };

  const canManageBookingsScope: BookingRouteContext['canManageBookingsScope'] = async ({
    organizationId,
    storeId,
    userId,
  }) => {
    if (!storeId) {
      return hasAdminOrOwnerAccess({
        database,
        organizationId,
        userId,
      });
    }

    const scoped = await resolveRequestedStoreAccess({
      organizationId,
      storeId,
      userId,
    });
    return scoped?.access.effective.canManageBookings ?? false;
  };

  const canManageParticipantsScope: BookingRouteContext['canManageParticipantsScope'] = async ({
    organizationId,
    storeId,
    userId,
  }) => {
    if (!storeId) {
      return hasAdminOrOwnerAccess({
        database,
        organizationId,
        userId,
      });
    }

    const scoped = await resolveRequestedStoreAccess({
      organizationId,
      storeId,
      userId,
    });
    return scoped?.access.effective.canManageParticipants ?? false;
  };

  const canReadServicesScope: BookingRouteContext['canReadServicesScope'] = async ({
    organizationId,
    storeId,
    userId,
  }) => {
    if (!storeId) {
      return hasAdminOrOwnerAccess({
        database,
        organizationId,
        userId,
      });
    }

    const scoped = await resolveRequestedStoreAccess({
      organizationId,
      storeId,
      userId,
    });
    if (!scoped) {
      return false;
    }

    return scoped.access.effective.canManageStore || scoped.access.effective.canManageBookings;
  };

  const canReadTicketTypesScope: BookingRouteContext['canReadTicketTypesScope'] = async ({
    organizationId,
    storeId,
    userId,
  }) => {
    if (!storeId) {
      return hasAdminOrOwnerAccess({
        database,
        organizationId,
        userId,
      });
    }

    const scoped = await resolveRequestedStoreAccess({
      organizationId,
      storeId,
      userId,
    });
    if (!scoped) {
      return false;
    }

    return scoped.access.effective.canManageStore || scoped.access.effective.canManageParticipants;
  };

  const listParticipantRecordsForUser: BookingRouteContext['listParticipantRecordsForUser'] =
    async ({ organizationId, storeId, userId }) => {
      return findParticipantsByUserAndOrganization({
        database,
        organizationId,
        storeId,
        userId,
      });
    };

  const readRemoteOrganizationEntitlement = async ({
    organizationId,
    key,
  }: {
    organizationId: string;
    key: string;
  }) => {
    return readBillingApiOrganizationFeatureEntitlement({
      database,
      env,
      organizationId,
      key,
      contactRole: 'premium_feature_guard',
      idempotencyKeyPrefix: 'reserve-feature-guard-sync',
    });
  };

  return {
    ...deps,
    requireIdentity,
    resolveScopedStoreContext,
    resolveRequestedStoreContext,
    resolveRequestedStoreAccess,
    canManageStoreScope,
    canManageBookingsScope,
    canManageParticipantsScope,
    canReadServicesScope,
    canReadTicketTypesScope,
    listParticipantRecordsForUser,
    requireOrganizationPremiumFeature: (organizationId) =>
      readOrganizationPremiumFeatureGate({
        database,
        env,
        organizationId,
        readRemoteEntitlement: readRemoteOrganizationEntitlement,
        requireRemoteEntitlement: true,
      }),
    requireOrganizationEntitlement: ({ organizationId, key }) =>
      readOrganizationEntitlementGate({
        database,
        env,
        organizationId,
        key,
        readRemoteEntitlement: readRemoteOrganizationEntitlement,
        requireRemoteEntitlement: true,
      }),
  };
};
