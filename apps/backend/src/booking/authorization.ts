import { and, asc, eq } from 'drizzle-orm';
import type { AuthInstance, AuthRuntimeDatabase } from '../auth-runtime.js';
import type { AuthRuntimeEnv } from '../auth-runtime.js';
import {
  hasOrganizationBillingPaidTierCapability,
  readOrganizationPremiumEntitlementPolicy,
  type OrganizationPremiumEntitlementPolicyResult,
} from '../billing/organization-billing-policy.js';
import * as dbSchema from '../db/schema.js';

export type SessionIdentity = {
  userId: string;
  email: string | null;
  activeOrganizationId: string | null;
};

export type OrganizationRole = 'owner' | 'admin' | 'member' | null;
export type ClassroomStaffRole = 'manager' | 'staff' | null;
export type AccessDisplayRole = 'owner' | 'admin' | 'manager' | 'staff' | 'participant' | null;
export type AccessSource = 'org_role' | 'classroom_member' | 'participant_record' | null;

export type OrganizationClassroomContext = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  classroomId: string;
  classroomSlug: string;
  classroomName: string;
};

export type OrganizationClassroomAccess = OrganizationClassroomContext & {
  facts: {
    orgRole: OrganizationRole;
    classroomStaffRole: ClassroomStaffRole;
    hasParticipantRecord: boolean;
  };
  effective: {
    canManageOrganization: boolean;
    canManageClassroom: boolean;
    canManageBookings: boolean;
    canManageParticipants: boolean;
    canUseParticipantBooking: boolean;
  };
  sources: {
    canManageOrganization: Extract<AccessSource, 'org_role'> | null;
    canManageClassroom: Extract<AccessSource, 'org_role' | 'classroom_member'> | null;
    canManageBookings: Extract<AccessSource, 'org_role' | 'classroom_member'> | null;
    canManageParticipants: Extract<AccessSource, 'org_role' | 'classroom_member'> | null;
    canUseParticipantBooking: Extract<AccessSource, 'participant_record'> | null;
  };
  display: {
    primaryRole: AccessDisplayRole;
    badges: Exclude<AccessDisplayRole, null>[];
  };
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

const normalizeClassroomStaffRole = (value: string | null): ClassroomStaffRole => {
  if (value === 'manager' || value === 'staff') {
    return value;
  }
  return null;
};

export const canManageOrganizationByRole = (role: OrganizationRole): boolean => {
  return role === 'owner' || role === 'admin';
};

export const canViewOrganizationBillingByRole = (role: OrganizationRole): boolean => {
  return role === 'owner' || role === 'admin' || role === 'member';
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

export const canManageClassroomByClassroomRole = (role: ClassroomStaffRole): boolean => {
  return role === 'manager';
};

export const canManageBookingsByClassroomRole = (role: ClassroomStaffRole): boolean => {
  return role === 'manager' || role === 'staff';
};

export const canManageParticipantsByClassroomRole = (role: ClassroomStaffRole): boolean => {
  return role === 'manager' || role === 'staff';
};

export const ORGANIZATION_PREMIUM_REQUIRED_MESSAGE =
  'Organization premium plan is required for this feature.';

export type OrganizationPremiumFeatureDeniedPayload = {
  message: typeof ORGANIZATION_PREMIUM_REQUIRED_MESSAGE;
  code: 'organization_premium_required';
  source: OrganizationPremiumEntitlementPolicyResult['source'];
  reason: OrganizationPremiumEntitlementPolicyResult['reason'];
  entitlementState: OrganizationPremiumEntitlementPolicyResult['entitlementState'];
  planState: OrganizationPremiumEntitlementPolicyResult['planState'];
  trialEndsAt: OrganizationPremiumEntitlementPolicyResult['trialEndsAt'];
};

export type OrganizationPremiumFeatureGate =
  | {
      allowed: true;
      policy: OrganizationPremiumEntitlementPolicyResult;
    }
  | {
      allowed: false;
      policy: OrganizationPremiumEntitlementPolicyResult;
      status: 403;
      body: OrganizationPremiumFeatureDeniedPayload;
    };

export const buildOrganizationPremiumFeatureDeniedPayload = (
  policy: OrganizationPremiumEntitlementPolicyResult,
): OrganizationPremiumFeatureDeniedPayload => {
  return {
    message: ORGANIZATION_PREMIUM_REQUIRED_MESSAGE,
    code: 'organization_premium_required',
    source: policy.source,
    reason: policy.reason,
    entitlementState: policy.entitlementState,
    planState: policy.planState,
    trialEndsAt: policy.trialEndsAt,
  };
};

export const readOrganizationPremiumFeatureGate = async ({
  database,
  env,
  organizationId,
  now,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  now?: Date;
}): Promise<OrganizationPremiumFeatureGate> => {
  const policy = await readOrganizationPremiumEntitlementPolicy({
    database,
    env,
    organizationId,
    now,
  });

  if (
    policy.isPremiumEligible
    && hasOrganizationBillingPaidTierCapability(policy.paidTier, 'organization_premium_features')
  ) {
    return {
      allowed: true,
      policy,
    };
  }

  return {
    allowed: false,
    policy,
    status: 403,
    body: buildOrganizationPremiumFeatureDeniedPayload(policy),
  };
};

const buildDisplayBadges = ({
  organizationRole,
  classroomStaffRole,
  hasParticipantRecord,
}: {
  organizationRole: OrganizationRole;
  classroomStaffRole: ClassroomStaffRole;
  hasParticipantRecord: boolean;
}): Exclude<AccessDisplayRole, null>[] => {
  const badges: Exclude<AccessDisplayRole, null>[] = [];
  if (organizationRole === 'owner' || organizationRole === 'admin') {
    badges.push(organizationRole);
  }
  if (classroomStaffRole) {
    badges.push(classroomStaffRole);
  }
  if (hasParticipantRecord) {
    badges.push('participant');
  }
  return Array.from(new Set(badges));
};

const resolvePrimaryRole = (badges: Exclude<AccessDisplayRole, null>[]): AccessDisplayRole => {
  if (badges.includes('owner')) {
    return 'owner';
  }
  if (badges.includes('admin')) {
    return 'admin';
  }
  if (badges.includes('manager')) {
    return 'manager';
  }
  if (badges.includes('staff')) {
    return 'staff';
  }
  if (badges.includes('participant')) {
    return 'participant';
  }
  return null;
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
  const classroomStaffRole = normalizeClassroomStaffRole(classroomMemberRows[0]?.role ?? null);
  const hasParticipantRecord = Boolean(participantRows[0]);

  const canManageOrganization = canManageOrganizationByRole(organizationRole);
  const canManageClassroomFromOrganization = canManageClassroomByRole(organizationRole);
  const canManageClassroomFromMembership = canManageClassroomByClassroomRole(classroomStaffRole);
  const canManageBookingsFromOrganization = canManageBookingsByRole(organizationRole);
  const canManageBookingsFromMembership = canManageBookingsByClassroomRole(classroomStaffRole);
  const canManageParticipantsFromOrganization = canManageParticipantsByRole(organizationRole);
  const canManageParticipantsFromMembership = canManageParticipantsByClassroomRole(classroomStaffRole);
  const canManageClassroom = canManageClassroomFromOrganization || canManageClassroomFromMembership;
  const canManageBookings = canManageBookingsFromOrganization || canManageBookingsFromMembership;
  const canManageParticipants = canManageParticipantsFromOrganization || canManageParticipantsFromMembership;
  const canUseParticipantBooking = hasParticipantRecord;
  const badges = buildDisplayBadges({
    organizationRole,
    classroomStaffRole,
    hasParticipantRecord,
  });

  return {
    ...context,
    facts: {
      orgRole: organizationRole,
      classroomStaffRole,
      hasParticipantRecord,
    },
    effective: {
      canManageOrganization,
      canManageClassroom,
      canManageBookings,
      canManageParticipants,
      canUseParticipantBooking,
    },
    sources: {
      canManageOrganization: canManageOrganization ? 'org_role' : null,
      canManageClassroom: canManageClassroomFromOrganization
        ? 'org_role'
        : canManageClassroomFromMembership
          ? 'classroom_member'
          : null,
      canManageBookings: canManageBookingsFromOrganization
        ? 'org_role'
        : canManageBookingsFromMembership
          ? 'classroom_member'
          : null,
      canManageParticipants: canManageParticipantsFromOrganization
        ? 'org_role'
        : canManageParticipantsFromMembership
          ? 'classroom_member'
          : null,
      canUseParticipantBooking: canUseParticipantBooking ? 'participant_record' : null,
    },
    display: {
      primaryRole: resolvePrimaryRole(badges),
      badges,
    },
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
  return access.effective.canManageOrganization;
};

export type ParticipantAccessRecord = {
  id: string;
  organizationId: string;
  classroomId: string;
  userId: string;
  email: string;
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
}): Promise<ParticipantAccessRecord | null> => {
  const rows = await findParticipantsByUserAndOrganization({
    database,
    organizationId,
    classroomId,
    userId,
  });
  return rows[0] ?? null;
};

export const findParticipantsByUserAndOrganization = async ({
  database,
  organizationId,
  classroomId,
  userId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string | null;
  userId: string;
}): Promise<ParticipantAccessRecord[]> => {
  return database
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
    .orderBy(asc(dbSchema.participant.createdAt), asc(dbSchema.participant.id));
};
