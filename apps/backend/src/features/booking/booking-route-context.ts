import { and, eq } from 'drizzle-orm';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import {
  findParticipantsByUserAndOrganization,
  getSessionIdentity,
  hasAdminOrOwnerAccess,
  readOrganizationEntitlementGate,
  readOrganizationPremiumFeatureGate,
  resolveOrganizationClassroomAccess,
  resolveOrganizationClassroomContext,
  type SessionIdentity,
} from '../../domain/booking/authorization.js';
import * as dbSchema from '../../infra/db/schema.js';
import type { ServiceImageUploadService } from '../../infra/storage/service-image-upload-service.js';

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
  resolveRequestedClassroomContext: (input: {
    organizationId: string;
    classroomId?: string | null;
  }) => Promise<{
    organizationId: string;
    organizationSlug: string;
    organizationName: string;
    classroomId: string;
    classroomSlug: string;
    classroomName: string;
  } | null>;
  resolveRequestedClassroomAccess: (input: {
    organizationId: string;
    classroomId?: string | null;
    userId: string;
  }) => Promise<{
    context: NonNullable<
      Awaited<ReturnType<BookingRouteContext['resolveRequestedClassroomContext']>>
    >;
    access: Awaited<ReturnType<typeof resolveOrganizationClassroomAccess>>;
  } | null>;
  canManageClassroomScope: (input: {
    organizationId: string;
    classroomId?: string | null;
    userId: string;
  }) => Promise<boolean>;
  canManageBookingsScope: (input: {
    organizationId: string;
    classroomId?: string | null;
    userId: string;
  }) => Promise<boolean>;
  canManageParticipantsScope: (input: {
    organizationId: string;
    classroomId?: string | null;
    userId: string;
  }) => Promise<boolean>;
  canReadServicesScope: (input: {
    organizationId: string;
    classroomId?: string | null;
    userId: string;
  }) => Promise<boolean>;
  canReadTicketTypesScope: (input: {
    organizationId: string;
    classroomId?: string | null;
    userId: string;
  }) => Promise<boolean>;
  listParticipantRecordsForUser: (input: {
    organizationId: string;
    classroomId?: string | null;
    userId: string;
  }) => Promise<Array<{ id: string; classroomId: string }>>;
  requireOrganizationPremiumFeature: (
    organizationId: string,
  ) => ReturnType<typeof readOrganizationPremiumFeatureGate>;
  requireOrganizationEntitlement: (input: {
    organizationId: string;
    key: string;
  }) => ReturnType<typeof readOrganizationEntitlementGate>;
};

/**
 * Hono route と usecase の間で共有する予約系コンテキストを生成します。
 *
 * @remarks
 * organization 全体の操作は owner/admin 権限、classroom 指定の操作は教室ごとの有効権限で判定します。
 */
export const createBookingRouteContext = (deps: BookingRouteDeps): BookingRouteContext => {
  const { auth, database, env } = deps;

  const requireIdentity = async (headers: Headers) => {
    return getSessionIdentity(auth, headers);
  };

  const resolveRequestedClassroomContext: BookingRouteContext['resolveRequestedClassroomContext'] =
    async ({ organizationId, classroomId }) => {
      if (!classroomId) {
        return resolveOrganizationClassroomContext({
          database,
          organizationId,
        });
      }

      const rows = await database
        .select({
          organizationId: dbSchema.organization.id,
          organizationSlug: dbSchema.organization.slug,
          organizationName: dbSchema.organization.name,
          classroomId: dbSchema.classroom.id,
          classroomSlug: dbSchema.classroom.slug,
          classroomName: dbSchema.classroom.name,
        })
        .from(dbSchema.classroom)
        .innerJoin(
          dbSchema.organization,
          eq(dbSchema.organization.id, dbSchema.classroom.organizationId),
        )
        .where(
          and(
            eq(dbSchema.classroom.organizationId, organizationId),
            eq(dbSchema.classroom.id, classroomId),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    };

  const resolveRequestedClassroomAccess: BookingRouteContext['resolveRequestedClassroomAccess'] =
    async ({ organizationId, classroomId, userId }) => {
      const context = await resolveRequestedClassroomContext({
        organizationId,
        classroomId,
      });
      if (!context) {
        return null;
      }

      const access = await resolveOrganizationClassroomAccess({
        database,
        userId,
        context,
      });
      return {
        context,
        access,
      };
    };

  const canManageClassroomScope: BookingRouteContext['canManageClassroomScope'] = async ({
    organizationId,
    classroomId,
    userId,
  }) => {
    if (!classroomId) {
      return hasAdminOrOwnerAccess({
        database,
        organizationId,
        userId,
      });
    }

    const scoped = await resolveRequestedClassroomAccess({
      organizationId,
      classroomId,
      userId,
    });
    return scoped?.access.effective.canManageClassroom ?? false;
  };

  const canManageBookingsScope: BookingRouteContext['canManageBookingsScope'] = async ({
    organizationId,
    classroomId,
    userId,
  }) => {
    if (!classroomId) {
      return hasAdminOrOwnerAccess({
        database,
        organizationId,
        userId,
      });
    }

    const scoped = await resolveRequestedClassroomAccess({
      organizationId,
      classroomId,
      userId,
    });
    return scoped?.access.effective.canManageBookings ?? false;
  };

  const canManageParticipantsScope: BookingRouteContext['canManageParticipantsScope'] = async ({
    organizationId,
    classroomId,
    userId,
  }) => {
    if (!classroomId) {
      return hasAdminOrOwnerAccess({
        database,
        organizationId,
        userId,
      });
    }

    const scoped = await resolveRequestedClassroomAccess({
      organizationId,
      classroomId,
      userId,
    });
    return scoped?.access.effective.canManageParticipants ?? false;
  };

  const canReadServicesScope: BookingRouteContext['canReadServicesScope'] = async ({
    organizationId,
    classroomId,
    userId,
  }) => {
    if (!classroomId) {
      return hasAdminOrOwnerAccess({
        database,
        organizationId,
        userId,
      });
    }

    const scoped = await resolveRequestedClassroomAccess({
      organizationId,
      classroomId,
      userId,
    });
    if (!scoped) {
      return false;
    }

    return scoped.access.effective.canManageClassroom || scoped.access.effective.canManageBookings;
  };

  const canReadTicketTypesScope: BookingRouteContext['canReadTicketTypesScope'] = async ({
    organizationId,
    classroomId,
    userId,
  }) => {
    if (!classroomId) {
      return hasAdminOrOwnerAccess({
        database,
        organizationId,
        userId,
      });
    }

    const scoped = await resolveRequestedClassroomAccess({
      organizationId,
      classroomId,
      userId,
    });
    if (!scoped) {
      return false;
    }

    return (
      scoped.access.effective.canManageClassroom || scoped.access.effective.canManageParticipants
    );
  };

  const listParticipantRecordsForUser: BookingRouteContext['listParticipantRecordsForUser'] =
    async ({ organizationId, classroomId, userId }) => {
      return findParticipantsByUserAndOrganization({
        database,
        organizationId,
        classroomId,
        userId,
      });
    };

  return {
    ...deps,
    requireIdentity,
    resolveRequestedClassroomContext,
    resolveRequestedClassroomAccess,
    canManageClassroomScope,
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
      }),
    requireOrganizationEntitlement: ({ organizationId, key }) =>
      readOrganizationEntitlementGate({
        database,
        env,
        organizationId,
        key,
      }),
  };
};
