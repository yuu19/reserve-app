import { and, asc, eq } from 'drizzle-orm';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import {
  getSessionIdentity,
  resolveOrganizationClassroomAccess,
  resolveOrganizationClassroomContext,
  resolveOrganizationId,
  type OrganizationClassroomAccess,
  type OrganizationClassroomContext,
  type SessionIdentity,
} from '../booking/authorization.js';
import { canAccessInternalBillingInspection } from '../billing/internal-operator-access.js';
import * as dbSchema from '../db/schema.js';
import { resolveAllowedVisibilities, type AiSourceVisibility } from './source-visibility.js';

export type AiRequestContext = {
  identity: SessionIdentity;
  access: OrganizationClassroomAccess;
  allowedVisibilities: AiSourceVisibility[];
  internalOperator: boolean;
  currentPage: string | null;
};

const getSessionEmailVerified = (session: unknown): boolean => {
  if (typeof session !== 'object' || session === null) {
    return false;
  }
  const record = session as Record<string, unknown>;
  const user = record.user;
  if (typeof user !== 'object' || user === null) {
    return false;
  }
  return (user as Record<string, unknown>).emailVerified === true;
};

const resolveContextByClassroomId = async ({
  database,
  organizationId,
  classroomId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId: string;
}): Promise<OrganizationClassroomContext | null> => {
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
      eq(dbSchema.classroom.organizationId, dbSchema.organization.id),
    )
    .where(
      and(eq(dbSchema.organization.id, organizationId), eq(dbSchema.classroom.id, classroomId)),
    )
    .orderBy(asc(dbSchema.classroom.createdAt))
    .limit(1);

  return rows[0] ?? null;
};

export const resolveAiRequestContext = async ({
  auth,
  database,
  env,
  headers,
  organizationId: requestedOrganizationId,
  classroomId: requestedClassroomId,
  currentPage,
}: {
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  headers: Headers;
  organizationId?: string | null;
  classroomId?: string | null;
  currentPage?: string | null;
}): Promise<AiRequestContext | null> => {
  const [identity, rawSession] = await Promise.all([
    getSessionIdentity(auth, headers),
    auth.api.getSession({ headers }),
  ]);

  if (!identity) {
    return null;
  }

  const organizationId = resolveOrganizationId(
    requestedOrganizationId ?? undefined,
    identity.activeOrganizationId,
  );
  if (!organizationId) {
    return null;
  }

  const context = requestedClassroomId
    ? await resolveContextByClassroomId({
        database,
        organizationId,
        classroomId: requestedClassroomId,
      })
    : await resolveOrganizationClassroomContext({
        database,
        organizationId,
      });

  if (!context) {
    return null;
  }

  const access = await resolveOrganizationClassroomAccess({
    database,
    userId: identity.userId,
    context,
  });

  const hasAnyAccess =
    Boolean(access.facts.orgRole) ||
    Boolean(access.facts.classroomStaffRole) ||
    access.facts.hasParticipantRecord;
  if (!hasAnyAccess) {
    return null;
  }

  const internalOperator = canAccessInternalBillingInspection({
    env,
    email: identity.email,
    emailVerified: getSessionEmailVerified(rawSession),
  });

  return {
    identity,
    access,
    allowedVisibilities: resolveAllowedVisibilities(access),
    internalOperator,
    currentPage: currentPage?.slice(0, 2048) ?? null,
  };
};
