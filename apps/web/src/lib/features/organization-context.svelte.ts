import type {
	AccessTreePayload,
	ClassroomRole,
	OrganizationPayload,
	ScopedApiContext
} from '$lib/rpc-client';
import {
	loadPortalAccess,
	parseResponseBody,
	readClassroomsFromAccessTree,
	readOrganizationsFromAccessTree,
	toErrorMessage
} from './auth-session.svelte';
import { authRpc } from '$lib/rpc-client';
import { writeLastUsedOrganizationId } from './organization-preference';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

export type ClassroomContextPayload = {
	id: string;
	slug: string;
	name: string;
	logo?: string | null;
	role: ClassroomRole | null;
	canManage: boolean;
	canUseParticipantBooking: boolean;
};

export type OrganizationContextPayload = {
	organizations: OrganizationPayload[];
	activeOrganization: OrganizationPayload | null;
	classrooms: ClassroomContextPayload[];
	activeClassroom: ClassroomContextPayload | null;
	activeContext: ScopedApiContext | null;
	accessTree: AccessTreePayload | null;
};

const asClassroomContextPayload = (value: unknown): ClassroomContextPayload | null => {
	if (!isRecord(value)) {
		return null;
	}
	if (typeof value.id !== 'string' || typeof value.slug !== 'string' || typeof value.name !== 'string') {
		return null;
	}
	const role = value.role;
	const classroomRole = role === 'manager' || role === 'staff' || role === 'participant' ? role : null;
	if (typeof value.canManage !== 'boolean' || typeof value.canUseParticipantBooking !== 'boolean') {
		return null;
	}
	return {
		id: value.id,
		slug: value.slug,
		name: value.name,
		logo: typeof value.logo === 'string' ? value.logo : null,
		role: classroomRole,
		canManage: value.canManage,
		canUseParticipantBooking: value.canUseParticipantBooking
	};
};

export const loadOrganizations = async (
	preferredContext: ScopedApiContext | null = null
): Promise<OrganizationContextPayload> => {
	const portalAccess = await loadPortalAccess(preferredContext);
	const accessTree = portalAccess.accessTree ?? null;
	const organizations = readOrganizationsFromAccessTree(accessTree);
	const activeOrganization =
		portalAccess.activeContext === null
			? null
			: organizations.find((organization) => organization.slug === portalAccess.activeContext?.orgSlug) ??
				null;
	if (activeOrganization?.id) {
		writeLastUsedOrganizationId(activeOrganization.id);
	}

	const classrooms = portalAccess.activeContext?.orgSlug
		? readClassroomsFromAccessTree(accessTree, portalAccess.activeContext.orgSlug)
		: [];
	const activeClassroom =
		portalAccess.activeContext === null
			? null
			: classrooms.find((classroom) => classroom.slug === portalAccess.activeContext?.classroomSlug) ?? null;

	return {
		organizations,
		activeOrganization,
		classrooms,
		activeClassroom,
		activeContext: portalAccess.activeContext ?? null,
		accessTree
	};
};

export const createOrganization = async (input: { name: string; slug: string; logo?: string }) => {
	const response = await authRpc.createOrganization(input);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok ? '組織を作成しました。' : toErrorMessage(payload, '組織作成に失敗しました。')
	};
};

// Backward-compat helper for existing settings/layout code path.
export const setActiveOrganization = async (organizationId: string | null) => {
	const response = await authRpc.setActiveOrganization({ organizationId });
	const payload = await parseResponseBody(response);
	if (response.ok) {
		writeLastUsedOrganizationId(organizationId);
	}
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? organizationId
				? '利用中の組織を切り替えました。'
				: '利用中の組織を解除しました。'
			: toErrorMessage(payload, '利用中の組織の更新に失敗しました。')
	};
};

export const uploadOrganizationLogo = async (file: File) => {
	const response = await authRpc.uploadOrganizationLogo(file);
	const payload = await parseResponseBody(response);
	if (!response.ok || !isRecord(payload) || typeof payload.logoUrl !== 'string') {
		return {
			ok: false,
			message: toErrorMessage(payload, '組織ロゴのアップロードに失敗しました。'),
			logoUrl: null as string | null
		};
	}
	return {
		ok: true,
		message: '組織ロゴをアップロードしました。',
		logoUrl: payload.logoUrl
	};
};

export const listClassroomsByOrgSlug = async (
	orgSlug: string
): Promise<ClassroomContextPayload[]> => {
	const response = await authRpc.listClassroomsByOrg(orgSlug);
	const payload = await parseResponseBody(response);
	if (!response.ok || !Array.isArray(payload)) {
		return [];
	}
	return payload
		.map((entry) => asClassroomContextPayload(entry))
		.filter((entry): entry is ClassroomContextPayload => entry !== null);
};
