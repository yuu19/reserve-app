import type { ChatRuntimeContext } from '@repo/saas-chatbot-core';
import { and, asc, eq } from 'drizzle-orm';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import {
  getSessionIdentity,
  resolveOrganizationStoreAccess,
  resolveOrganizationStoreContext,
  resolveOrganizationId,
  type OrganizationStoreAccess,
  type OrganizationStoreContext,
  type SessionIdentity,
} from '../../domain/booking/authorization.js';
import { canAccessInternalBillingInspection } from '../../domain/billing/internal-operator-access.js';
import * as dbSchema from '../../infra/db/schema.js';
import { resolveAllowedVisibilities, type AiSourceVisibility } from './source-visibility.js';

export type AiRequestContext = {
  identity: SessionIdentity;
  access: OrganizationStoreAccess;
  runtimeContext: ChatRuntimeContext;
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

const resolveContextByStoreId = async ({
  database,
  organizationId,
  storeId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
}): Promise<OrganizationStoreContext | null> => {
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
    .innerJoin(dbSchema.organization, eq(dbSchema.store.organizationId, dbSchema.organization.id))
    .where(and(eq(dbSchema.organization.id, organizationId), eq(dbSchema.store.id, storeId)))
    .orderBy(asc(dbSchema.store.createdAt))
    .limit(1);

  return rows[0] ?? null;
};

/**
 * AI リクエストのユーザー、スコープ、可視性予算、内部運用者フラグを解決する。
 *
 * クライアント指定の組織・店舗 ID で所属レコード以上にアクセスが広がらないよう、
 * チャットルートは検索・生成の前にこの関数を通す。
 */
export const resolveAiRequestContext = async ({
  auth,
  database,
  env,
  headers,
  organizationId: requestedOrganizationId,
  storeId: requestedStoreId,
  currentPage,
}: {
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  headers: Headers;
  organizationId?: string | null;
  storeId?: string | null;
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

  const context = requestedStoreId
    ? await resolveContextByStoreId({
        database,
        organizationId,
        storeId: requestedStoreId,
      })
    : await resolveOrganizationStoreContext({
        database,
        organizationId,
      });

  if (!context) {
    return null;
  }

  const access = await resolveOrganizationStoreAccess({
    database,
    userId: identity.userId,
    context,
  });

  const hasAnyAccess =
    Boolean(access.facts.orgRole) ||
    Boolean(access.facts.storeStaffRole) ||
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
    runtimeContext: {
      subjectType: 'organization',
      subjectId: access.organizationId,
      actorUserId: identity.userId,
      storeId: access.storeId,
      channel: 'web',
      locale: 'ja',
      currentPage: currentPage?.slice(0, 2048) ?? null,
    },
    allowedVisibilities: resolveAllowedVisibilities(access),
    internalOperator,
    currentPage: currentPage?.slice(0, 2048) ?? null,
  };
};
