import type { OrganizationClassroomAccess } from '../booking/authorization.js';

export const AI_SOURCE_VISIBILITIES = [
  'public',
  'authenticated',
  'participant',
  'staff',
  'manager',
  'admin',
  'owner',
] as const;

export type AiSourceVisibility = (typeof AI_SOURCE_VISIBILITIES)[number];
export type AiSourceKind = 'docs' | 'specs' | 'faq' | 'db_summary';

export type AiSourceScope = {
  visibility: string;
  internalOnly?: boolean | null;
  organizationId?: string | null;
  classroomId?: string | null;
  locale?: string | null;
};

export type AiAccessContext = {
  access: OrganizationClassroomAccess;
  internalOperator?: boolean;
};

const isAiSourceVisibility = (value: string): value is AiSourceVisibility =>
  AI_SOURCE_VISIBILITIES.includes(value as AiSourceVisibility);

export const normalizeAiSourceVisibility = (
  value: string | null | undefined,
): AiSourceVisibility => (value && isAiSourceVisibility(value) ? value : 'authenticated');

export const resolveAiPrimaryRole = (
  access: OrganizationClassroomAccess,
): AiSourceVisibility | 'authenticated' => {
  if (access.facts.orgRole === 'owner') {
    return 'owner';
  }
  if (access.facts.orgRole === 'admin') {
    return 'admin';
  }
  if (access.facts.classroomStaffRole === 'manager') {
    return 'manager';
  }
  if (access.facts.classroomStaffRole === 'staff') {
    return 'staff';
  }
  if (access.facts.hasParticipantRecord) {
    return 'participant';
  }
  return 'authenticated';
};

export const resolveAllowedVisibilities = (
  access: OrganizationClassroomAccess,
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

export const canUseInternalKnowledge = ({
  access,
  internalOperator = false,
}: AiAccessContext): boolean => {
  if (internalOperator) {
    return true;
  }
  return access.facts.orgRole === 'owner' || access.facts.orgRole === 'admin';
};

export const isSourceScopeAllowed = ({
  source,
  access,
  allowedVisibilities = resolveAllowedVisibilities(access),
  internalOperator = false,
  locale = 'ja',
}: {
  source: AiSourceScope;
  access: OrganizationClassroomAccess;
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

  if (source.classroomId && source.classroomId !== access.classroomId) {
    return false;
  }

  return true;
};

export type AiSourceReference = {
  sourceKind: AiSourceKind;
  title: string;
  sourcePath?: string | null;
  chunkId?: string | null;
  visibility?: AiSourceVisibility;
  internalOnly?: boolean | null;
};

export const sanitizeSourceReference = ({
  source,
  access,
  internalOperator = false,
}: {
  source: AiSourceReference;
  access: OrganizationClassroomAccess;
  internalOperator?: boolean;
}): AiSourceReference | null => {
  if (
    !isSourceScopeAllowed({
      source: {
        visibility: source.visibility ?? 'authenticated',
        internalOnly: source.internalOnly ?? false,
        organizationId: null,
        classroomId: null,
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
