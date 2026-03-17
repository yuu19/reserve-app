import { getRemoteSession } from '$lib/remote/session.remote';
import {
	authRpc,
	type AccessTreePayload,
	type AccessDisplayPayload,
	type AccessDisplayRole,
	type AccessEffectivePayload,
	type AccessFactsPayload,
	type AccessSourcesPayload,
	type AuthSessionPayload,
	type InvitationPayload,
	type OrganizationMembershipRole,
	type OrganizationPayload,
	type ScopedApiContext
} from '$lib/rpc-client';
import { buildLoginRedirectHref } from './auth-portal';
import { extractScopedRouteContext } from './scoped-routing';
import { readLastUsedOrganizationId, writeLastUsedOrganizationId } from './organization-preference';

export type JsonRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

const isOrganizationPayload = (value: unknown): value is OrganizationPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.slug === 'string';

const asOrganizations = (value: unknown): OrganizationPayload[] =>
	Array.isArray(value) ? value.filter(isOrganizationPayload) : [];

const isInvitationPayload = (value: unknown): value is InvitationPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.email === 'string' &&
	typeof value.subjectKind === 'string' &&
	typeof value.status === 'string';

const asInvitations = (value: unknown): InvitationPayload[] =>
	Array.isArray(value) ? value.filter(isInvitationPayload) : [];

const asOrganizationRole = (value: unknown): OrganizationMembershipRole | null => {
	if (value === 'owner' || value === 'admin' || value === 'member') {
		return value;
	}
	return null;
};

const isAccessTreeClassroom = (value: unknown): value is AccessTreePayload['orgs'][number]['classrooms'][number] =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.slug === 'string' &&
	typeof value.name === 'string' &&
	isRecord(value.facts) &&
	isRecord(value.effective) &&
	isRecord(value.sources) &&
	isRecord(value.display) &&
	(value.facts.orgRole === null || asOrganizationRole(value.facts.orgRole) !== null) &&
	(value.facts.classroomStaffRole === null ||
		value.facts.classroomStaffRole === 'manager' ||
		value.facts.classroomStaffRole === 'staff') &&
	typeof value.facts.hasParticipantRecord === 'boolean' &&
	typeof value.effective.canManageOrganization === 'boolean' &&
	typeof value.effective.canManageClassroom === 'boolean' &&
	typeof value.effective.canManageBookings === 'boolean' &&
	typeof value.effective.canManageParticipants === 'boolean' &&
	typeof value.effective.canUseParticipantBooking === 'boolean' &&
	(value.sources.canManageOrganization === null || value.sources.canManageOrganization === 'org_role') &&
		(value.sources.canManageClassroom === null ||
			value.sources.canManageClassroom === 'org_role' ||
			value.sources.canManageClassroom === 'classroom_member') &&
		(value.sources.canManageBookings === null ||
			value.sources.canManageBookings === 'org_role' ||
			value.sources.canManageBookings === 'classroom_member') &&
		(value.sources.canManageParticipants === null ||
			value.sources.canManageParticipants === 'org_role' ||
			value.sources.canManageParticipants === 'classroom_member') &&
		(value.sources.canUseParticipantBooking === null ||
			value.sources.canUseParticipantBooking === 'participant_record') &&
		(value.display.primaryRole === null ||
			value.display.primaryRole === 'owner' ||
			value.display.primaryRole === 'admin' ||
			value.display.primaryRole === 'manager' ||
			value.display.primaryRole === 'staff' ||
			value.display.primaryRole === 'participant') &&
		Array.isArray(value.display.badges);

const isAccessTreeOrg = (value: unknown): value is AccessTreePayload['orgs'][number] =>
	isRecord(value) &&
	isRecord(value.org) &&
	typeof value.org.id === 'string' &&
	typeof value.org.slug === 'string' &&
	typeof value.org.name === 'string' &&
	Array.isArray(value.classrooms) &&
	value.classrooms.every((classroom) => isAccessTreeClassroom(classroom));

const asAccessTreePayload = (value: unknown): AccessTreePayload | null => {
	if (!isRecord(value) || !Array.isArray(value.orgs)) {
		return null;
	}
	if (!value.orgs.every((orgEntry) => isAccessTreeOrg(orgEntry))) {
		return null;
	}
	return value as AccessTreePayload;
};

	type LegacyAccessTreeClassroom = {
		classroomId: string;
		classroomSlug: string;
		classroomName: string;
	role?: unknown;
	canManage: boolean;
	canUseParticipantBooking: boolean;
	logo?: unknown;
};

type LegacyAccessTreeOrganization = {
	organizationId: string;
	organizationSlug: string;
	organizationName: string;
	role?: unknown;
	classrooms: LegacyAccessTreeClassroom[];
	logo?: unknown;
};

const isLegacyAccessTreeClassroom = (value: unknown): value is LegacyAccessTreeClassroom =>
	isRecord(value) &&
	typeof value.classroomId === 'string' &&
	typeof value.classroomSlug === 'string' &&
	typeof value.classroomName === 'string' &&
	typeof value.canManage === 'boolean' &&
	typeof value.canUseParticipantBooking === 'boolean';

const isLegacyAccessTreeOrganization = (value: unknown): value is LegacyAccessTreeOrganization =>
	isRecord(value) &&
	typeof value.organizationId === 'string' &&
	typeof value.organizationSlug === 'string' &&
	typeof value.organizationName === 'string' &&
	Array.isArray(value.classrooms) &&
	value.classrooms.every((classroom) => isLegacyAccessTreeClassroom(classroom));

const normalizeLegacyAccessTreePayload = (value: unknown): AccessTreePayload | null => {
	if (!Array.isArray(value) || !value.every((orgEntry) => isLegacyAccessTreeOrganization(orgEntry))) {
		return null;
	}

		return {
			orgs: value.map((orgEntry) => ({
				org: {
					id: orgEntry.organizationId,
					slug: orgEntry.organizationSlug,
					name: orgEntry.organizationName,
					logo: typeof orgEntry.logo === 'string' ? orgEntry.logo : null
				},
				classrooms: orgEntry.classrooms.map((classroom) => {
					const isLegacyManager = classroom.role === 'manager';
					const isLegacyStaff = classroom.role === 'staff';
					const hasLegacyRole = isLegacyManager || isLegacyStaff || classroom.role === 'participant';
					const canManageClassroom = isLegacyManager || (!hasLegacyRole && classroom.canManage);
					const canManageBookings =
						isLegacyManager || isLegacyStaff || (!hasLegacyRole && classroom.canManage);
					const canManageParticipants =
						isLegacyManager || isLegacyStaff || (!hasLegacyRole && classroom.canManage);

					return {
						id: classroom.classroomId,
						slug: classroom.classroomSlug,
						name: classroom.classroomName,
						logo: typeof classroom.logo === 'string' ? classroom.logo : null,
						facts: {
							orgRole: asOrganizationRole(orgEntry.role ?? null),
							classroomStaffRole:
								classroom.role === 'manager' || classroom.role === 'staff' ? classroom.role : null,
							hasParticipantRecord: classroom.canUseParticipantBooking
						},
						effective: {
							canManageOrganization:
								orgEntry.role === 'owner' || orgEntry.role === 'admin',
							canManageClassroom,
							canManageBookings,
							canManageParticipants,
							canUseParticipantBooking: classroom.canUseParticipantBooking
						},
						sources: {
							canManageOrganization:
								orgEntry.role === 'owner' || orgEntry.role === 'admin' ? 'org_role' : null,
							canManageClassroom: canManageClassroom ? 'classroom_member' : null,
							canManageBookings: canManageBookings ? 'classroom_member' : null,
							canManageParticipants: canManageParticipants ? 'classroom_member' : null,
							canUseParticipantBooking: classroom.canUseParticipantBooking ? 'participant_record' : null
						},
						display: {
							primaryRole:
								classroom.role === 'manager' ||
								classroom.role === 'staff' ||
								classroom.role === 'participant'
									? classroom.role
									: orgEntry.role === 'owner' || orgEntry.role === 'admin'
										? orgEntry.role
										: null,
							badges:
								classroom.role === 'manager' ||
								classroom.role === 'staff' ||
								classroom.role === 'participant'
									? [classroom.role]
									: orgEntry.role === 'owner' || orgEntry.role === 'admin'
										? [orgEntry.role]
										: []
						}
					};
				})
			}))
		};
};

export const normalizeAccessTreePayload = (value: unknown): AccessTreePayload | null =>
	asAccessTreePayload(value) ?? normalizeLegacyAccessTreePayload(value);

export const asSessionPayload = (value: unknown): AuthSessionPayload => {
	if (value === null) {
		return null;
	}
	if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.session)) {
		return null;
	}
	return { user: value.user, session: value.session };
};

export const parseResponseBody = async (response: Response): Promise<unknown> => {
	const contentType = response.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		return response.json();
	}
	const text = await response.text();
	if (!text) {
		return null;
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
};

export const toErrorMessage = (payload: unknown, fallback: string): string => {
	if (isRecord(payload) && typeof payload.message === 'string') {
		return payload.message;
	}
	if (isRecord(payload) && typeof payload.error === 'string') {
		return payload.error;
	}
	if (typeof payload === 'string' && payload.length > 0) {
		return payload;
	}
	return fallback;
};

export const getNextPathFromSearch = (): string | null => {
	if (typeof window === 'undefined') {
		return null;
	}
	const searchParams = new URLSearchParams(window.location.search);
	const next = searchParams.get('next');
	if (!next || !next.startsWith('/')) {
		return null;
	}
	return next;
};

export const navigateToNextIfNeeded = (): boolean => {
	if (typeof window === 'undefined') {
		return false;
	}
	const next = getNextPathFromSearch();
	if (!next) {
		return false;
	}
	const url = new URL(next, 'http://localhost');
	window.location.assign(`${url.pathname}${url.search}${url.hash}`);
	return true;
};

export type PendingInvitationHomePath =
	| '/participant/admin-invitations'
	| '/participant/invitations';

export const resolvePendingInvitationHomePath = (
	invitations: InvitationPayload[]
): PendingInvitationHomePath | null => {
	const pendingInvitations = invitations.filter((invitation) => invitation.status === 'pending');
	if (
		pendingInvitations.some(
			(invitation) =>
				invitation.subjectKind === 'org_operator' || invitation.subjectKind === 'classroom_operator'
		)
	) {
		return '/participant/admin-invitations';
	}
	if (pendingInvitations.some((invitation) => invitation.subjectKind === 'participant')) {
		return '/participant/invitations';
	}
	return null;
};

export const loadPendingInvitationHomePath = async (): Promise<PendingInvitationHomePath | null> => {
	try {
		const response = await authRpc.listUserInvitations();
		const payload = await parseResponseBody(response);
		if (!response.ok) {
			return null;
		}
		return resolvePendingInvitationHomePath(asInvitations(payload));
	} catch {
		return null;
	}
};

export const redirectToLoginWithNext = (nextPath: string) => {
	if (typeof window === 'undefined') {
		return;
	}
	window.location.assign(buildLoginRedirectHref(nextPath));
};

export const getCurrentPathWithSearch = (): string => {
	if (typeof window === 'undefined') {
		return '/';
	}
	return `${window.location.pathname}${window.location.search}${window.location.hash}`;
};

export const loadSession = async (): Promise<{ session: AuthSessionPayload; status: number }> => {
	try {
		if (typeof window !== 'undefined') {
			const response = await authRpc.getSession();
			const payload = await parseResponseBody(response);
			if (!response.ok) {
				return { session: null, status: response.status };
			}
			return {
				session: asSessionPayload(payload),
				status: response.status
			};
		}
		return await getRemoteSession();
	} catch {
		return { session: null, status: 503 };
	}
};

export type PortalAccess = {
	// Stage 1: across organizations/classrooms
	hasOrganizationAdminAccess: boolean;
	hasAdminPortalAccess: boolean;
	hasParticipantAccess: boolean;
	// Stage 2: active classroom in URL context (or inferred default)
	canManage: boolean;
	canManageClassroom: boolean;
	canManageBookings: boolean;
	canManageParticipants: boolean;
	canUseParticipantBooking: boolean;
	activeOrganizationRole: OrganizationMembershipRole | null;
	activeFacts: AccessFactsPayload | null;
	activeSources: AccessSourcesPayload | null;
	activeDisplay: AccessDisplayPayload | null;
	activeDisplayRole: AccessDisplayRole | null;
	hasActiveOrganization: boolean;
	activeContext?: ScopedApiContext | null;
	accessTree?: AccessTreePayload | null;
};

const emptyPortalAccess = (): PortalAccess => ({
	hasOrganizationAdminAccess: false,
	hasAdminPortalAccess: false,
	hasParticipantAccess: false,
	canManage: false,
	canManageClassroom: false,
	canManageBookings: false,
	canManageParticipants: false,
	canUseParticipantBooking: false,
	activeOrganizationRole: null,
	activeFacts: null,
	activeSources: null,
	activeDisplay: null,
	activeDisplayRole: null,
	hasActiveOrganization: false,
	activeContext: null,
	accessTree: null
});

type FlatAccessEntry = {
	orgId: string;
	orgSlug: string;
	orgRole: OrganizationMembershipRole | null;
	classroomSlug: string;
	facts: AccessFactsPayload;
	effective: AccessEffectivePayload;
	sources: AccessSourcesPayload;
	display: AccessDisplayPayload;
	canManage: boolean;
	canManageClassroom: boolean;
	canManageBookings: boolean;
	canManageParticipants: boolean;
	canAccessAdminPortal: boolean;
	canUseParticipantBooking: boolean;
};

const flattenAccessTree = (tree: AccessTreePayload): FlatAccessEntry[] => {
	const entries: FlatAccessEntry[] = [];
		for (const orgEntry of tree.orgs) {
			for (const classroom of orgEntry.classrooms) {
				entries.push({
					orgId: orgEntry.org.id,
					orgSlug: orgEntry.org.slug,
					orgRole: classroom.facts.orgRole,
					classroomSlug: classroom.slug,
					facts: classroom.facts,
					effective: classroom.effective,
					sources: classroom.sources,
					display: classroom.display,
					canManage: classroom.effective.canManageClassroom,
					canManageClassroom: classroom.effective.canManageClassroom,
					canManageBookings: classroom.effective.canManageBookings,
					canManageParticipants: classroom.effective.canManageParticipants,
					canAccessAdminPortal:
						classroom.effective.canManageOrganization ||
						classroom.effective.canManageClassroom ||
						classroom.effective.canManageBookings ||
						classroom.effective.canManageParticipants,
					canUseParticipantBooking: classroom.effective.canUseParticipantBooking
				});
			}
		}
	return entries;
};

const findEntryByContext = (
	entries: FlatAccessEntry[],
	context: ScopedApiContext | null
): FlatAccessEntry | null => {
	if (!context) {
		return null;
	}
	return (
		entries.find(
			(entry) =>
				entry.orgSlug === context.orgSlug && entry.classroomSlug === context.classroomSlug
		) ?? null
	);
};

const resolveDefaultEntry = (
	entries: FlatAccessEntry[],
	preferredContext: ScopedApiContext | null
): FlatAccessEntry | null => {
	if (entries.length === 0) {
		return null;
	}
	const explicitEntry = findEntryByContext(entries, preferredContext);
	if (explicitEntry) {
		return explicitEntry;
	}

	const pathContext =
		typeof window === 'undefined' ? null : extractScopedRouteContext(window.location.pathname);
	const pathEntry = findEntryByContext(entries, pathContext);
	if (pathEntry) {
		return pathEntry;
	}

	const lastUsedOrgId = readLastUsedOrganizationId();
	if (lastUsedOrgId) {
		const sameOrgEntry =
			entries.find((entry) => entry.orgId === lastUsedOrgId && entry.canAccessAdminPortal) ??
			entries.find((entry) => entry.orgId === lastUsedOrgId && entry.canUseParticipantBooking) ??
			entries.find((entry) => entry.orgId === lastUsedOrgId) ??
			null;
		if (sameOrgEntry) {
			return sameOrgEntry;
		}
	}

	return (
		entries.find((entry) => entry.canAccessAdminPortal) ??
		entries.find((entry) => entry.canUseParticipantBooking) ??
		entries[0] ??
		null
	);
};

export const resolveLastUsedOrganizationId = (
	organizations: OrganizationPayload[],
	lastUsedOrganizationId: string | null
): string | null => {
	if (!lastUsedOrganizationId) {
		return null;
	}
	return organizations.some((organization) => organization.id === lastUsedOrganizationId)
		? lastUsedOrganizationId
		: null;
};

export const loadPortalAccess = async (
	preferredContext: ScopedApiContext | null = null
): Promise<PortalAccess> => {
	try {
		const accessTreeResponse = await authRpc.getAccessTree();
		const accessTreePayload = await parseResponseBody(accessTreeResponse);
		if (!accessTreeResponse.ok) {
			return emptyPortalAccess();
		}

			const accessTree = normalizeAccessTreePayload(accessTreePayload);
		if (!accessTree) {
			return emptyPortalAccess();
		}

			const entries = flattenAccessTree(accessTree);
			const hasOrganizationAdminAccess = entries.some(
				(entry) => entry.effective.canManageOrganization
			);
			const hasAdminPortalAccess = entries.some((entry) => entry.canAccessAdminPortal);
			const hasParticipantAccess = entries.some(
				(entry) => entry.effective.canUseParticipantBooking
			);
			const activeEntry = resolveDefaultEntry(entries, preferredContext);
		if (activeEntry) {
			writeLastUsedOrganizationId(activeEntry.orgId);
		}

		return {
				hasOrganizationAdminAccess,
				hasAdminPortalAccess,
				hasParticipantAccess,
				canManage: activeEntry?.effective.canManageClassroom ?? false,
				canManageClassroom: activeEntry?.effective.canManageClassroom ?? false,
				canManageBookings: activeEntry?.effective.canManageBookings ?? false,
				canManageParticipants: activeEntry?.effective.canManageParticipants ?? false,
				canUseParticipantBooking: activeEntry?.effective.canUseParticipantBooking ?? false,
				activeOrganizationRole: activeEntry?.facts.orgRole ?? null,
				activeFacts: activeEntry?.facts ?? null,
				activeSources: activeEntry?.sources ?? null,
				activeDisplay: activeEntry?.display ?? null,
				activeDisplayRole: activeEntry?.display.primaryRole ?? null,
				hasActiveOrganization: Boolean(activeEntry),
			activeContext: activeEntry
				? {
					orgSlug: activeEntry.orgSlug,
					classroomSlug: activeEntry.classroomSlug
				}
				: null,
			accessTree
		};
	} catch {
		return emptyPortalAccess();
	}
};

export const hasAnyPortalAccess = (portalAccess: PortalAccess): boolean =>
	portalAccess.hasAdminPortalAccess || portalAccess.hasParticipantAccess;

export type PortalHomePath =
	| '/admin/dashboard'
	| '/admin/bookings'
	| '/admin/participants'
	| '/participant/home';

export const resolvePortalHomePath = (
	portalAccess: PortalAccess
): PortalHomePath | null => {
	if (portalAccess.hasOrganizationAdminAccess) {
		return '/admin/dashboard';
	}
	if (portalAccess.canManageClassroom || portalAccess.canManageBookings) {
		return '/admin/bookings';
	}
	if (portalAccess.canManageParticipants) {
		return '/admin/participants';
	}
	if (portalAccess.hasAdminPortalAccess) {
		return '/admin/bookings';
	}
	if (portalAccess.hasParticipantAccess || portalAccess.canUseParticipantBooking) {
		return '/participant/home';
	}
	return null;
};

export const getContextFromAccessTree = (
	accessTree: AccessTreePayload | null | undefined,
	orgSlug: string,
	classroomSlug: string
): ScopedApiContext | null => {
	if (!accessTree) {
		return null;
	}
	for (const orgEntry of accessTree.orgs) {
		if (orgEntry.org.slug !== orgSlug) {
			continue;
		}
		if (orgEntry.classrooms.some((classroom) => classroom.slug === classroomSlug)) {
			return { orgSlug, classroomSlug };
		}
	}
	return null;
};

export const getScopedContextFromUrlPath = (
	accessTree: AccessTreePayload | null | undefined,
	path: string
): ScopedApiContext | null => {
	const pathContext = extractScopedRouteContext(path);
	if (!pathContext) {
		return null;
	}
	return getContextFromAccessTree(accessTree, pathContext.orgSlug, pathContext.classroomSlug);
};

export const readOrganizationsFromAccessTree = (accessTree: AccessTreePayload | null): OrganizationPayload[] => {
	if (!accessTree) {
		return [];
	}
	return accessTree.orgs.map((orgEntry) => ({
		id: orgEntry.org.id,
		name: orgEntry.org.name,
		slug: orgEntry.org.slug,
		logo: typeof orgEntry.org.logo === 'string' ? orgEntry.org.logo : null
	}));
};

export const readClassroomsFromAccessTree = (
	accessTree: AccessTreePayload | null,
	orgSlug: string
): Array<{
	id: string;
	slug: string;
	name: string;
	logo?: string | null;
	canManage: boolean;
	canManageClassroom: boolean;
	canManageBookings: boolean;
	canManageParticipants: boolean;
	canUseParticipantBooking: boolean;
	display: AccessDisplayPayload;
	facts: AccessFactsPayload;
	sources: AccessSourcesPayload;
}> => {
	if (!accessTree) {
		return [];
	}
	const organization = accessTree.orgs.find((orgEntry) => orgEntry.org.slug === orgSlug);
	if (!organization) {
		return [];
	}
		return organization.classrooms.map((classroom) => ({
			id: classroom.id,
			slug: classroom.slug,
			name: classroom.name,
			logo: typeof classroom.logo === 'string' ? classroom.logo : null,
			canManage: classroom.effective.canManageClassroom,
			canManageClassroom: classroom.effective.canManageClassroom,
			canManageBookings: classroom.effective.canManageBookings,
			canManageParticipants: classroom.effective.canManageParticipants,
			canUseParticipantBooking: classroom.effective.canUseParticipantBooking,
			display: classroom.display,
			facts: classroom.facts,
			sources: classroom.sources
		}));
};

export const loadOrganizationsFromAccessTree = async (): Promise<OrganizationPayload[]> => {
	const response = await authRpc.getAccessTree();
	const payload = await parseResponseBody(response);
	if (!response.ok) {
		return [];
	}
	const accessTree = normalizeAccessTreePayload(payload);
	return readOrganizationsFromAccessTree(accessTree);
};

export const loadClassroomsByOrgSlug = async (
	orgSlug: string
): Promise<Array<{ id: string; slug: string; name: string; logo?: string | null }>> => {
	const response = await authRpc.listClassroomsByOrg(orgSlug);
	const payload = await parseResponseBody(response);
	if (!response.ok || !Array.isArray(payload)) {
		return [];
	}
	return payload
		.filter(
			(entry) =>
				isRecord(entry) &&
				typeof entry.id === 'string' &&
				typeof entry.slug === 'string' &&
				typeof entry.name === 'string'
		)
		.map((entry) => ({
			id: entry.id as string,
			slug: entry.slug as string,
			name: entry.name as string,
			logo: typeof entry.logo === 'string' ? entry.logo : null
		}));
};

export const loadOrganizations = async (): Promise<OrganizationPayload[]> => {
	const response = await authRpc.listOrganizations();
	const payload = await parseResponseBody(response);
	return response.ok ? asOrganizations(payload) : [];
};
