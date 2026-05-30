import { and, asc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { AuthInstance, AuthRuntimeDatabase } from '../../auth-runtime.js';
import type { AuthRuntimeEnv } from '../../auth-runtime.js';
import {
  readReserveAppPremiumEntitlementPolicy,
  type ReserveAppPremiumEntitlementPolicyResult,
} from '../billing/reserve-app-billing-entitlement-policy.js';
import * as dbSchema from '../../infra/db/schema.js';

/** Route authorization に必要な Better Auth session の最小 identity。 */
export type SessionIdentity = {
  userId: string;
  email: string | null;
  activeOrganizationId: string | null;
};

/** Better Auth organization member role を application authorization 向けに正規化した値。 */
export type OrganizationRole = 'owner' | 'admin' | 'member' | null;

/** 店舗 staff membership の role。 */
export type StoreStaffRole = 'manager' | 'staff' | null;

/** UI が表示する代表 role。organization、store、participant を横断して決める。 */
export type AccessDisplayRole = 'owner' | 'admin' | 'manager' | 'staff' | 'participant' | null;

/** Effective permission がどの所属情報から付与されたかを表す source。 */
export type AccessSource = 'org_role' | 'store_member' | 'participant_record' | null;

/** Scoped routing と authorization が共有する organization/store の表示 context。 */
export type OrganizationStoreContext = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  storeId: string;
  storeSlug: string;
  storeName: string;
};

/** Organization/store context に、所属 facts、effective permissions、表示 role を合成した access 情報。 */
export type OrganizationStoreAccess = OrganizationStoreContext & {
  facts: {
    orgRole: OrganizationRole;
    storeStaffRole: StoreStaffRole;
    hasParticipantRecord: boolean;
  };
  effective: {
    canManageOrganization: boolean;
    canManageStore: boolean;
    canManageBookings: boolean;
    canManageParticipants: boolean;
    canUseParticipantBooking: boolean;
  };
  sources: {
    canManageOrganization: Extract<AccessSource, 'org_role'> | null;
    canManageStore: Extract<AccessSource, 'org_role' | 'store_member'> | null;
    canManageBookings: Extract<AccessSource, 'org_role' | 'store_member'> | null;
    canManageParticipants: Extract<AccessSource, 'org_role' | 'store_member'> | null;
    canUseParticipantBooking: Extract<AccessSource, 'participant_record'> | null;
  };
  display: {
    primaryRole: AccessDisplayRole;
    badges: Exclude<AccessDisplayRole, null>[];
  };
};

/** unknown 値から空でない string だけを取り出す。 */
export const getStringValue = (value: unknown): string | null => {
  return typeof value === 'string' && value.length > 0 ? value : null;
};

/** メールアドレス比較用に前後空白と大文字小文字を正規化する。 */
export const normalizeEmail = (value: string): string => {
  return value.trim().toLowerCase();
};

/** Better Auth session payload から active organization id を読み取る。 */
export const getActiveOrganizationId = (session: unknown): string | null => {
  if (typeof session !== 'object' || session === null) {
    return null;
  }

  const currentSession = session as Record<string, unknown>;
  const activeOrganizationId = currentSession.activeOrganizationId;
  return typeof activeOrganizationId === 'string' ? activeOrganizationId : null;
};

/** Better Auth session から、route authorization に必要な最小の user identity だけを取り出す。 */
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

/** request が organization id を明示していない場合、session の active organization id を使う。 */
export const resolveOrganizationId = (
  requestedOrganizationId: string | undefined,
  activeOrganizationId: string | null,
): string | null => {
  return requestedOrganizationId ?? activeOrganizationId;
};

/** Legacy の organization slug と store slug が同一だった公開 URL 形状に合わせる。 */
export const toStoreSlug = (organizationSlug: string): string => {
  return organizationSlug;
};

const normalizeOrganizationRole = (value: string | null): OrganizationRole => {
  if (value === 'owner' || value === 'admin' || value === 'member') {
    return value;
  }
  return null;
};

const normalizeStoreStaffRole = (value: string | null): StoreStaffRole => {
  if (value === 'manager' || value === 'staff') {
    return value;
  }
  return null;
};

/** Organization role から組織管理権限を判定する。 */
export const canManageOrganizationByRole = (role: OrganizationRole): boolean => {
  return role === 'owner' || role === 'admin';
};

/** Organization role から課金情報の閲覧権限を判定する。 */
export const canViewOrganizationBillingByRole = (role: OrganizationRole): boolean => {
  return role === 'owner' || role === 'admin' || role === 'member';
};

/** Organization role から店舗管理権限を判定する。 */
export const canManageStoreByRole = (role: OrganizationRole): boolean => {
  return role === 'owner' || role === 'admin';
};

/** Organization role から予約管理権限を判定する。 */
export const canManageBookingsByRole = (role: OrganizationRole): boolean => {
  return role === 'owner' || role === 'admin';
};

/** Organization role から参加者管理権限を判定する。 */
export const canManageParticipantsByRole = (role: OrganizationRole): boolean => {
  return role === 'owner' || role === 'admin';
};

/** Store staff role から店舗管理権限を判定する。 */
export const canManageStoreByStoreRole = (role: StoreStaffRole): boolean => {
  return role === 'manager';
};

/** Store staff role から予約管理権限を判定する。 */
export const canManageBookingsByStoreRole = (role: StoreStaffRole): boolean => {
  return role === 'manager' || role === 'staff';
};

/** Store staff role から参加者管理権限を判定する。 */
export const canManageParticipantsByStoreRole = (role: StoreStaffRole): boolean => {
  return role === 'manager' || role === 'staff';
};

/** Premium entitlement がない機能で返す共通 error message。 */
export const ORGANIZATION_PREMIUM_REQUIRED_MESSAGE =
  'Organization premium plan is required for this feature.';

/** Premium 機能が拒否されたとき route が返す payload。 */
export type OrganizationPremiumFeatureDeniedPayload = {
  message: typeof ORGANIZATION_PREMIUM_REQUIRED_MESSAGE;
  code: 'organization_premium_required';
  source: ReserveAppPremiumEntitlementPolicyResult['source'];
  reason: ReserveAppPremiumEntitlementPolicyResult['reason'];
  entitlementState: ReserveAppPremiumEntitlementPolicyResult['entitlementState'];
  planState: ReserveAppPremiumEntitlementPolicyResult['planState'];
  trialEndsAt: ReserveAppPremiumEntitlementPolicyResult['trialEndsAt'];
};

/** Premium feature gate の許可/拒否結果。拒否時は route がそのまま返せる body を含む。 */
export type OrganizationPremiumFeatureGate =
  | {
      allowed: true;
      policy: ReserveAppPremiumEntitlementPolicyResult;
    }
  | {
      allowed: false;
      policy: ReserveAppPremiumEntitlementPolicyResult;
      status: 403;
      body: OrganizationPremiumFeatureDeniedPayload;
    };

/** Organization entitlement gate を評価する入力。 */
export type OrganizationEntitlementGateInput = {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  key: string;
  now?: Date;
};

/** Organization entitlement gate の評価結果。 */
export type OrganizationEntitlementGate = OrganizationPremiumFeatureGate;

/** Premium entitlement policy から route error payload を作る。 */
export const buildOrganizationPremiumFeatureDeniedPayload = (
  policy: ReserveAppPremiumEntitlementPolicyResult,
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

const hasActiveBillingEntitlement = async ({
  database,
  organizationId,
  key,
  now,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  key: string;
  now: Date;
}) => {
  const rows = await database
    .select({
      id: dbSchema.billingEntitlement.id,
    })
    .from(dbSchema.billingAccount)
    .innerJoin(
      dbSchema.billingEntitlement,
      eq(dbSchema.billingEntitlement.billingAccountId, dbSchema.billingAccount.id),
    )
    .where(
      and(
        eq(dbSchema.billingAccount.subjectType, 'organization'),
        eq(dbSchema.billingAccount.subjectId, organizationId),
        eq(dbSchema.billingEntitlement.key, key),
        eq(dbSchema.billingEntitlement.active, true),
        or(
          isNull(dbSchema.billingEntitlement.validFrom),
          lte(dbSchema.billingEntitlement.validFrom, now),
        ),
        or(
          isNull(dbSchema.billingEntitlement.validUntil),
          gt(dbSchema.billingEntitlement.validUntil, now),
        ),
      ),
    )
    .limit(1);

  return Boolean(rows[0]);
};

/** 指定 entitlement key が有効かを読み、Premium policy と合わせて route gate として返す。 */
export const readOrganizationEntitlementGate = async ({
  database,
  env,
  organizationId,
  key,
  now = new Date(),
}: OrganizationEntitlementGateInput): Promise<OrganizationEntitlementGate> => {
  const policy = await readReserveAppPremiumEntitlementPolicy({
    database,
    env,
    organizationId,
    now,
  });

  if (await hasActiveBillingEntitlement({ database, organizationId, key, now })) {
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

/** Premium 機能の route guard と UI 表示で共通に使う entitlement gate を読む。 */
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
  return readOrganizationEntitlementGate({
    database,
    env,
    organizationId,
    key: 'organization.premium',
    now,
  });
};

const buildDisplayBadges = ({
  organizationRole,
  storeStaffRole,
  hasParticipantRecord,
}: {
  organizationRole: OrganizationRole;
  storeStaffRole: StoreStaffRole;
  hasParticipantRecord: boolean;
}): Exclude<AccessDisplayRole, null>[] => {
  const badges: Exclude<AccessDisplayRole, null>[] = [];
  if (organizationRole === 'owner' || organizationRole === 'admin') {
    badges.push(organizationRole);
  }
  if (storeStaffRole) {
    badges.push(storeStaffRole);
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

/**
 * organization id/slug と optional store slug から、scope 付き store context を解決する。
 *
 * store slug が省略された場合は legacy organization-as-store 形状にも fallback する。
 */
export const resolveOrganizationStoreContext = async ({
  database,
  organizationId,
  organizationSlug,
  storeSlug,
}: {
  database: AuthRuntimeDatabase;
  organizationId?: string | null;
  organizationSlug?: string | null;
  storeSlug?: string | null;
}): Promise<OrganizationStoreContext | null> => {
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

  const defaultStoreSlug = toStoreSlug(organization.slug);
  const targetStoreSlug = (storeSlug ?? defaultStoreSlug).trim();

  const storeRows = await database
    .select({
      id: dbSchema.store.id,
      slug: dbSchema.store.slug,
      name: dbSchema.store.name,
    })
    .from(dbSchema.store)
    .where(eq(dbSchema.store.organizationId, organization.id))
    .orderBy(asc(dbSchema.store.createdAt));

  const resolvedStore =
    storeRows.find((row: (typeof storeRows)[number]) => row.slug === targetStoreSlug) ??
    (storeSlug
      ? null
      : (storeRows.find((row: (typeof storeRows)[number]) => row.id === organization.id) ??
        storeRows.find((row: (typeof storeRows)[number]) => row.slug === defaultStoreSlug) ??
        storeRows[0]));

  if (!resolvedStore) {
    return null;
  }

  return {
    organizationId: organization.id,
    organizationSlug: organization.slug,
    organizationName: organization.name,
    storeId: resolvedStore.id,
    storeSlug: resolvedStore.slug,
    storeName: resolvedStore.name,
  };
};

/** organization 配下の store context を一覧し、scoped routing の切替候補として返す。 */
export const listOrganizationStoreContexts = async ({
  database,
  organizationId,
  organizationSlug,
}: {
  database: AuthRuntimeDatabase;
  organizationId?: string | null;
  organizationSlug?: string | null;
}): Promise<OrganizationStoreContext[]> => {
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

  const storeRows = await database
    .select({
      id: dbSchema.store.id,
      slug: dbSchema.store.slug,
      name: dbSchema.store.name,
    })
    .from(dbSchema.store)
    .where(eq(dbSchema.store.organizationId, organization.id))
    .orderBy(asc(dbSchema.store.createdAt));

  return storeRows.map((store: (typeof storeRows)[number]) => ({
    organizationId: organization.id,
    organizationSlug: organization.slug,
    organizationName: organization.name,
    storeId: store.id,
    storeSlug: store.slug,
    storeName: store.name,
  }));
};

/**
 * organization role、store member role、participant record を合成し、画面と API で使う effective access を返す。
 */
export const resolveOrganizationStoreAccess = async ({
  database,
  userId,
  context,
}: {
  database: AuthRuntimeDatabase;
  userId: string;
  context: OrganizationStoreContext;
}): Promise<OrganizationStoreAccess> => {
  const [memberRows, storeMemberRows, participantRows] = await Promise.all([
    database
      .select({
        role: dbSchema.member.role,
      })
      .from(dbSchema.member)
      .where(
        and(
          eq(dbSchema.member.organizationId, context.organizationId),
          eq(dbSchema.member.userId, userId),
        ),
      )
      .limit(1),
    database
      .select({
        role: dbSchema.storeMember.role,
      })
      .from(dbSchema.storeMember)
      .where(
        and(
          eq(dbSchema.storeMember.storeId, context.storeId),
          eq(dbSchema.storeMember.userId, userId),
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
          eq(dbSchema.participant.storeId, context.storeId),
          eq(dbSchema.participant.userId, userId),
        ),
      )
      .limit(1),
  ]);

  const organizationRole = normalizeOrganizationRole(memberRows[0]?.role ?? null);
  const storeStaffRole = normalizeStoreStaffRole(storeMemberRows[0]?.role ?? null);
  const hasParticipantRecord = Boolean(participantRows[0]);

  const canManageOrganization = canManageOrganizationByRole(organizationRole);
  const canManageStoreFromOrganization = canManageStoreByRole(organizationRole);
  const canManageStoreFromMembership = canManageStoreByStoreRole(storeStaffRole);
  const canManageBookingsFromOrganization = canManageBookingsByRole(organizationRole);
  const canManageBookingsFromMembership = canManageBookingsByStoreRole(storeStaffRole);
  const canManageParticipantsFromOrganization = canManageParticipantsByRole(organizationRole);
  const canManageParticipantsFromMembership = canManageParticipantsByStoreRole(storeStaffRole);
  const canManageStore = canManageStoreFromOrganization || canManageStoreFromMembership;
  const canManageBookings = canManageBookingsFromOrganization || canManageBookingsFromMembership;
  const canManageParticipants =
    canManageParticipantsFromOrganization || canManageParticipantsFromMembership;
  const canUseParticipantBooking = hasParticipantRecord;
  const badges = buildDisplayBadges({
    organizationRole,
    storeStaffRole,
    hasParticipantRecord,
  });

  return {
    ...context,
    facts: {
      orgRole: organizationRole,
      storeStaffRole,
      hasParticipantRecord,
    },
    effective: {
      canManageOrganization,
      canManageStore,
      canManageBookings,
      canManageParticipants,
      canUseParticipantBooking,
    },
    sources: {
      canManageOrganization: canManageOrganization ? 'org_role' : null,
      canManageStore: canManageStoreFromOrganization
        ? 'org_role'
        : canManageStoreFromMembership
          ? 'store_member'
          : null,
      canManageBookings: canManageBookingsFromOrganization
        ? 'org_role'
        : canManageBookingsFromMembership
          ? 'store_member'
          : null,
      canManageParticipants: canManageParticipantsFromOrganization
        ? 'org_role'
        : canManageParticipantsFromMembership
          ? 'store_member'
          : null,
      canUseParticipantBooking: canUseParticipantBooking ? 'participant_record' : null,
    },
    display: {
      primaryRole: resolvePrimaryRole(badges),
      badges,
    },
  };
};

/** User が organization の owner/admin 権限を持つかを確認する。 */
export const hasAdminOrOwnerAccess = async ({
  database,
  organizationId,
  userId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  userId: string;
}): Promise<boolean> => {
  const context = await resolveOrganizationStoreContext({
    database,
    organizationId,
  });
  if (!context) {
    return false;
  }

  const access = await resolveOrganizationStoreAccess({
    database,
    userId,
    context,
  });
  return access.effective.canManageOrganization;
};

/** ログインユーザーに紐づく participant record の最小識別情報。 */
export type ParticipantAccessRecord = {
  id: string;
  organizationId: string;
  storeId: string;
  userId: string;
  email: string;
  name: string;
};

/** User と organization/store scope に一致する participant record を 1 件返す。 */
export const findParticipantByUserAndOrganization = async ({
  database,
  organizationId,
  storeId,
  userId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string | null;
  userId: string;
}): Promise<ParticipantAccessRecord | null> => {
  const rows = await findParticipantsByUserAndOrganization({
    database,
    organizationId,
    storeId,
    userId,
  });
  return rows[0] ?? null;
};

/** User と organization scope に一致する participant records を作成順で返す。 */
export const findParticipantsByUserAndOrganization = async ({
  database,
  organizationId,
  storeId,
  userId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string | null;
  userId: string;
}): Promise<ParticipantAccessRecord[]> => {
  return database
    .select({
      id: dbSchema.participant.id,
      organizationId: dbSchema.participant.organizationId,
      storeId: dbSchema.participant.storeId,
      userId: dbSchema.participant.userId,
      email: dbSchema.participant.email,
      name: dbSchema.participant.name,
    })
    .from(dbSchema.participant)
    .where(
      and(
        eq(dbSchema.participant.organizationId, organizationId),
        ...(storeId ? [eq(dbSchema.participant.storeId, storeId)] : []),
        eq(dbSchema.participant.userId, userId),
      ),
    )
    .orderBy(asc(dbSchema.participant.createdAt), asc(dbSchema.participant.id));
};
