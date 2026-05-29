import {
  AI_SOURCE_KINDS,
  AI_SOURCE_VISIBILITIES,
  type AiSourceKind,
  type AiGeneratedSourceReference,
  type AiSourceScope,
  type AiSourceReference,
  type AiSourceVisibility,
  type SourceVisibilityPolicy,
} from '@repo/saas-chatbot-core';
import type { OrganizationStoreAccess } from '../../domain/booking/authorization.js';

export { AI_SOURCE_KINDS, AI_SOURCE_VISIBILITIES };
export type {
  AiGeneratedSourceReference,
  AiSourceKind,
  AiSourceReference,
  AiSourceScope,
  AiSourceVisibility,
};

export type AiAccessContext = {
  access: OrganizationStoreAccess;
  internalOperator?: boolean;
};

const isAiSourceVisibility = (value: string): value is AiSourceVisibility =>
  AI_SOURCE_VISIBILITIES.includes(value as AiSourceVisibility);

/** 不明な visibility は黙って public へ倒さず authenticated として扱う。 */
export const normalizeAiSourceVisibility = (
  value: string | null | undefined,
): AiSourceVisibility => (value && isAiSourceVisibility(value) ? value : 'authenticated');

/** 現在の access facts から読み取れる最上位の AI source visibility role を解決する。 */
export const resolveAiPrimaryRole = (
  access: OrganizationStoreAccess,
): AiSourceVisibility | 'authenticated' => {
  if (access.facts.orgRole === 'owner') {
    return 'owner';
  }
  if (access.facts.orgRole === 'admin') {
    return 'admin';
  }
  if (access.facts.storeStaffRole === 'manager') {
    return 'manager';
  }
  if (access.facts.storeStaffRole === 'staff') {
    return 'staff';
  }
  if (access.facts.hasParticipantRecord) {
    return 'participant';
  }
  return 'authenticated';
};

/** 単一の組織・店舗 context でユーザーが読める source visibility を列挙する。 */
export const resolveAllowedVisibilities = (
  access: OrganizationStoreAccess,
): AiSourceVisibility[] => {
  const base: AiSourceVisibility[] = ['public', 'authenticated'];
  const role = resolveAiPrimaryRole(access);

  switch (role) {
    case 'owner':
      return [...AI_SOURCE_VISIBILITIES];
    case 'admin':
      return [...base, 'participant', 'staff', 'manager', 'admin'];
    case 'manager':
      return [...base, 'participant', 'staff', 'manager'];
    case 'staff':
      return [...base, 'participant', 'staff'];
    case 'participant':
      return [...base, 'participant'];
    default:
      return base;
  }
};

/** owner/admin は内部ナレッジを読め、設定済み internal operator は組織 role check を bypass する。 */
export const canUseInternalKnowledge = ({
  access,
  internalOperator = false,
}: AiAccessContext): boolean => {
  if (internalOperator) {
    return true;
  }
  return access.facts.orgRole === 'owner' || access.facts.orgRole === 'admin';
};

/** source row に visibility、internal-only、locale、組織、店舗の各 check を適用する。 */
export const isSourceScopeAllowed = ({
  source,
  access,
  allowedVisibilities = resolveAllowedVisibilities(access),
  internalOperator = false,
  locale = 'ja',
}: {
  source: AiSourceScope;
  access: OrganizationStoreAccess;
  allowedVisibilities?: AiSourceVisibility[];
  internalOperator?: boolean;
  locale?: string;
}): boolean => {
  const visibility = normalizeAiSourceVisibility(source.visibility);
  if (!allowedVisibilities.includes(visibility)) {
    return false;
  }

  if (source.internalOnly && !canUseInternalKnowledge({ access, internalOperator })) {
    return false;
  }

  if (source.locale && source.locale !== locale) {
    return false;
  }

  if (source.organizationId && source.organizationId !== access.organizationId) {
    return false;
  }

  if (source.storeId && source.storeId !== access.storeId) {
    return false;
  }

  return true;
};

export const sanitizeSourceReference = ({
  source,
  access,
  internalOperator = false,
}: {
  source: AiGeneratedSourceReference;
  access: OrganizationStoreAccess;
  internalOperator?: boolean;
}): AiSourceReference | null => {
  if (
    !isSourceScopeAllowed({
      source: {
        visibility: source.visibility ?? 'authenticated',
        internalOnly: source.internalOnly ?? false,
        organizationId: null,
        storeId: null,
      },
      access,
      internalOperator,
    })
  ) {
    return null;
  }

  const canShowPath =
    source.sourceKind !== 'specs' || internalOperator || access.facts.orgRole === 'owner';

  return {
    sourceKind: source.sourceKind,
    title: source.title,
    sourcePath: canShowPath ? (source.sourcePath ?? null) : null,
    chunkId: source.chunkId ?? null,
    visibility: source.visibility,
  };
};

export type ReserveAppSourceVisibilityPolicy = SourceVisibilityPolicy<OrganizationStoreAccess>;

export const reserveAppSourceVisibilityPolicy: ReserveAppSourceVisibilityPolicy = {
  resolveAllowedVisibilities,
  canUseInternalKnowledge: ({ context, internalOperator = false }) =>
    canUseInternalKnowledge({ access: context, internalOperator }),
  canReadSource: ({
    source,
    context,
    allowedVisibilities = resolveAllowedVisibilities(context),
    internalOperator = false,
    locale = 'ja',
  }) =>
    isSourceScopeAllowed({
      source,
      access: context,
      allowedVisibilities,
      internalOperator,
      locale,
    }),
  sanitizeSourceReference: ({ source, context, internalOperator = false }) =>
    sanitizeSourceReference({ source, access: context, internalOperator }),
};
