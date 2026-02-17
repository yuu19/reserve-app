import { and, eq } from 'drizzle-orm';
import type { AuthInstance, AuthRuntimeDatabase } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';

export type SessionIdentity = {
  userId: string;
  email: string | null;
  activeOrganizationId: string | null;
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

export const hasAdminOrOwnerAccess = async ({
  database,
  organizationId,
  userId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  userId: string;
}): Promise<boolean> => {
  const rows = await database
    .select({
      role: dbSchema.member.role,
    })
    .from(dbSchema.member)
    .where(and(eq(dbSchema.member.organizationId, organizationId), eq(dbSchema.member.userId, userId)))
    .limit(1);

  const role = rows[0]?.role;
  return role === 'admin' || role === 'owner';
};

export const findParticipantByUserAndOrganization = async ({
  database,
  organizationId,
  userId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  userId: string;
}) => {
  const rows = await database
    .select({
      id: dbSchema.participant.id,
      organizationId: dbSchema.participant.organizationId,
      userId: dbSchema.participant.userId,
      email: dbSchema.participant.email,
    })
    .from(dbSchema.participant)
    .where(
      and(
        eq(dbSchema.participant.organizationId, organizationId),
        eq(dbSchema.participant.userId, userId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
};

