import { and, asc, eq } from 'drizzle-orm';
import type { AuthInstance, AuthRuntimeDatabase } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';

export type SessionIdentity = {
  userId: string;
  email: string | null;
  activeOrganizationId: string | null;
};

export type OrganizationRole = 'owner' | 'admin' | 'member' | null;
export type ClassroomRole = 'manager' | 'staff' | 'participant' | null;

export type OrganizationClassroomContext = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  classroomId: string;
  classroomSlug: string;
  classroomName: string;
};

export type OrganizationClassroomAccess = OrganizationClassroomContext & {
  organizationRole: OrganizationRole;
  classroomRole: ClassroomRole;
  hasParticipantAccess: boolean;
  canManageOrganization: boolean;
  canManageClassroom: boolean;
  canManageBookings: boolean;
  canManageParticipants: boolean;
  canUseParticipantBooking: boolean;
};

export const getStringValue = (value: unknown): string | null => {
  return typeof value === 'string' && value.length > 0 ? value : null;
};

export const normalizeEmail = (value: string): string => {
  return value.trim().toLowerCase();
};

export const getActiveOrganizationId = (session: unknown): string | null => {
  if (typeof session !== 'object' || session === null) {
    return null;
  }

  const currentSession = session as Record<string, unknown>;
  const activeOrganizationId = currentSession.activeOrganizationId;
  return typeof activeOrganizationId === 'string' ? activeOrganizationId : null;
};

export const getSessionIdentity = async (
  auth: AuthInstance,
  headers: Headers,
): Promise<SessionIdentity | null> => {
  const session = await auth.api.getSession({ headers });
  const userId = getStringValue(session?.user?.id);
  if (!userId) {
    return null;
  }

  const userEmail = getStringValue(session?.user?.email);
  return {
    userId,
    email: userEmail ? normalizeEmail(userEmail) : null,
    activeOrganizationId: getActiveOrganizationId(session?.session),
  };
};

export const resolveOrganizationId = (
  requestedOrganizationId: string | undefined,
  activeOrganizationId: string | null,
): string | null => {
  return requestedOrganizationId ?? activeOrganizationId;
};

export const toClassroomSlug = (organizationSlug: string): string => {
  return organizationSlug;
};

const normalizeOrganizationRole = (value: string | null): OrganizationRole => {
  if (value === 'owner' || value === 'admin' || value === 'member') {
    return value;
  }
  return null;
};

const normalizeClassroomRole = (value: string | null): ClassroomRole => {
  if (value === 'manager' || value === 'staff' || value === 'participant') {
    return value;
  }
  return null;
};

const mapOrganizationRoleToClassroomRole = (role: OrganizationRole): Exclude<ClassroomRole, 'participant' | null> | null => {
  if (role === 'owner' || role === 'admin') {
    return 'manager';
  }
  return null;
};

export const canManageOrganizationByRole = (role: OrganizationRole): boolean => {
  return role === 'owner' || role === 'admin';
};

export const canManageClassroomByRole = (role: OrganizationRole): boolean => {
  return role === 'owner' || role === 'admin';
};

export const canManageBookingsByRole = (role: OrganizationRole): boolean => {
  return role === 'owner' || role === 'admin';
};

export const canManageParticipantsByRole = (role: OrganizationRole): boolean => {
  return role === 'owner' || role === 'admin';
};

export const canManageClassroomByClassroomRole = (role: ClassroomRole): boolean => {
  return role === 'manager';
};

export const canManageBookingsByClassroomRole = (role: ClassroomRole): boolean => {
  return role === 'manager' || role === 'staff';
};

export const canManageParticipantsByClassroomRole = (role: ClassroomRole): boolean => {
  return role === 'manager' || role === 'staff';
};

export const resolveOrganizationClassroomContext = async ({
  database,
  organizationId,
  organizationSlug,
  classroomSlug,
}: {
  database: AuthRuntimeDatabase;
  organizationId?: string | null;
  organizationSlug?: string | null;
  classroomSlug?: string | null;
}): Promise<OrganizationClassroomContext | null> => {
  if (!organizationId && !organizationSlug) {
    return null;
  }

  const rows = await database
    .select({
      id: dbSchema.organization.id,
      slug: dbSchema.organization.slug,
      name: dbSchema.organization.name,
    })
    .from(dbSchema.organization)
    .where(
      organizationId
        ? eq(dbSchema.organization.id, organizationId)
        : eq(dbSchema.organization.slug, organizationSlug as string),
    )
    .limit(1);
  const organization = rows[0];
  if (!organization) {
    return null;
  }

  const defaultClassroomSlug = toClassroomSlug(organization.slug);
  const targetClassroomSlug = (classroomSlug ?? defaultClassroomSlug).trim();

  const classroomRows = await database
    .select({
      id: dbSchema.classroom.id,
      slug: dbSchema.classroom.slug,
      name: dbSchema.classroom.name,
    })
    .from(dbSchema.classroom)
    .where(eq(dbSchema.classroom.organizationId, organization.id))
    .orderBy(asc(dbSchema.classroom.createdAt));

  const resolvedClassroom =
    classroomRows.find((row: (typeof classroomRows)[number]) => row.slug === targetClassroomSlug) ??
    (classroomSlug
      ? null
      : classroomRows.find((row: (typeof classroomRows)[number]) => row.id === organization.id) ??
        classroomRows.find((row: (typeof classroomRows)[number]) => row.slug === defaultClassroomSlug) ??
        classroomRows[0]);

  if (!resolvedClassroom) {
    return null;
  }

  return {
    organizationId: organization.id,
    organizationSlug: organization.slug,
    organizationName: organization.name,
    classroomId: resolvedClassroom.id,
    classroomSlug: resolvedClassroom.slug,
    classroomName: resolvedClassroom.name,
  };
};

export const listOrganizationClassroomContexts = async ({
  database,
  organizationId,
  organizationSlug,
}: {
  database: AuthRuntimeDatabase;
  organizationId?: string | null;
  organizationSlug?: string | null;
}): Promise<OrganizationClassroomContext[]> => {
  if (!organizationId && !organizationSlug) {
    return [];
  }

  const organizationRows = await database
    .select({
      id: dbSchema.organization.id,
      slug: dbSchema.organization.slug,
      name: dbSchema.organization.name,
    })
    .from(dbSchema.organization)
    .where(
      organizationId
        ? eq(dbSchema.organization.id, organizationId)
        : eq(dbSchema.organization.slug, organizationSlug as string),
    )
    .limit(1);
  const organization = organizationRows[0];
  if (!organization) {
    return [];
  }

  const classroomRows = await database
    .select({
      id: dbSchema.classroom.id,
      slug: dbSchema.classroom.slug,
      name: dbSchema.classroom.name,
    })
    .from(dbSchema.classroom)
    .where(eq(dbSchema.classroom.organizationId, organization.id))
    .orderBy(asc(dbSchema.classroom.createdAt));

  return classroomRows.map((classroom: (typeof classroomRows)[number]) => ({
    organizationId: organization.id,
    organizationSlug: organization.slug,
    organizationName: organization.name,
    classroomId: classroom.id,
    classroomSlug: classroom.slug,
    classroomName: classroom.name,
  }));
};

export const resolveOrganizationClassroomAccess = async ({
  database,
  userId,
  context,
}: {
  database: AuthRuntimeDatabase;
  userId: string;
  context: OrganizationClassroomContext;
}): Promise<OrganizationClassroomAccess> => {
  const [memberRows, classroomMemberRows, participantRows] = await Promise.all([
    database
      .select({
        role: dbSchema.member.role,
      })
      .from(dbSchema.member)
      .where(
        and(eq(dbSchema.member.organizationId, context.organizationId), eq(dbSchema.member.userId, userId)),
      )
      .limit(1),
    database
      .select({
        role: dbSchema.classroomMember.role,
      })
      .from(dbSchema.classroomMember)
      .where(
        and(
          eq(dbSchema.classroomMember.classroomId, context.classroomId),
          eq(dbSchema.classroomMember.userId, userId),
        ),
      )
      .limit(1),
    database
      .select({
        id: dbSchema.participant.id,
      })
      .from(dbSchema.participant)
      .where(
        and(
          eq(dbSchema.participant.classroomId, context.classroomId),
          eq(dbSchema.participant.userId, userId),
        ),
      )
      .limit(1),
  ]);

  const organizationRole = normalizeOrganizationRole(memberRows[0]?.role ?? null);
  const classroomRoleFromOrganization = mapOrganizationRoleToClassroomRole(organizationRole);
  const classroomRoleFromMembership = normalizeClassroomRole(classroomMemberRows[0]?.role ?? null);
  const hasParticipantAccess = Boolean(participantRows[0]);

  const classroomRole: ClassroomRole =
    classroomRoleFromOrganization ?? classroomRoleFromMembership ?? (hasParticipantAccess ? 'participant' : null);

  const canManageOrganization = canManageOrganizationByRole(organizationRole);
  const canManageClassroom =
    canManageClassroomByRole(organizationRole) || canManageClassroomByClassroomRole(classroomRole);
  const canManageBookings =
    canManageBookingsByRole(organizationRole) || canManageBookingsByClassroomRole(classroomRole);
  const canManageParticipants =
    canManageParticipantsByRole(organizationRole) || canManageParticipantsByClassroomRole(classroomRole);

  return {
    ...context,
    organizationRole,
    classroomRole,
    hasParticipantAccess,
    canManageOrganization,
    canManageClassroom,
    canManageBookings,
    canManageParticipants,
    canUseParticipantBooking: hasParticipantAccess,
  };
};

export const hasAdminOrOwnerAccess = async ({
  database,
  organizationId,
  userId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  userId: string;
}): Promise<boolean> => {
  const context = await resolveOrganizationClassroomContext({
    database,
    organizationId,
  });
  if (!context) {
    return false;
  }

  const access = await resolveOrganizationClassroomAccess({
    database,
    userId,
    context,
  });
  return access.canManageOrganization;
};

export const findParticipantByUserAndOrganization = async ({
  database,
  organizationId,
  classroomId,
  userId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string | null;
  userId: string;
}) => {
  const rows = await database
    .select({
      id: dbSchema.participant.id,
      organizationId: dbSchema.participant.organizationId,
      classroomId: dbSchema.participant.classroomId,
      userId: dbSchema.participant.userId,
      email: dbSchema.participant.email,
    })
    .from(dbSchema.participant)
    .where(
      and(
        eq(dbSchema.participant.organizationId, organizationId),
        ...(classroomId ? [eq(dbSchema.participant.classroomId, classroomId)] : []),
        eq(dbSchema.participant.userId, userId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
};
