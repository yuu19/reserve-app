import type {
	AccessTreePayload,
	AccessDisplayPayload,
	AccessFactsPayload,
	AccessSourcesPayload,
	ClassroomPayload,
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

const isOrganizationPayload = (value: unknown): value is OrganizationPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.name === 'string' &&
	typeof value.slug === 'string';

export type ClassroomContextPayload = {
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
	const effective = isRecord(value.effective) ? value.effective : null;
	if (
		!effective ||
		typeof effective.canManageClassroom !== 'boolean' ||
		typeof effective.canManageBookings !== 'boolean' ||
		typeof effective.canManageParticipants !== 'boolean' ||
		typeof effective.canUseParticipantBooking !== 'boolean' ||
		!isRecord(value.display) ||
		!isRecord(value.facts) ||
		!isRecord(value.sources)
	) {
		return null;
	}
	return {
		id: value.id,
		slug: value.slug,
		name: value.name,
		logo: typeof value.logo === 'string' ? value.logo : null,
		canManage: effective.canManageClassroom,
		canManageClassroom: effective.canManageClassroom,
		canManageBookings: effective.canManageBookings,
		canManageParticipants: effective.canManageParticipants,
		canUseParticipantBooking: effective.canUseParticipantBooking,
		display: value.display as AccessDisplayPayload,
		facts: value.facts as AccessFactsPayload,
		sources: value.sources as AccessSourcesPayload
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
	const organization = isOrganizationPayload(payload) ? payload : null;
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok ? '組織を作成しました。' : toErrorMessage(payload, '組織作成に失敗しました。'),
		organization
	};
};

export const createOrganizationWithInitialClassroom = async (input: {
	organizationName: string;
	organizationSlug: string;
	classroomName?: string;
	classroomSlug?: string;
	logo?: string;
}) => {
	const organizationResult = await createOrganization({
		name: input.organizationName,
		slug: input.organizationSlug,
		logo: input.logo
	});
	if (!organizationResult.ok || !organizationResult.organization) {
		return {
			ok: false,
			status: organizationResult.status,
			message: organizationResult.message,
			organization: null as OrganizationPayload | null,
			classroom: null as ClassroomContextPayload | null
		};
	}

	await setActiveOrganization(organizationResult.organization.id);

	const classroomName = input.classroomName?.trim() ?? '';
	const classroomSlug = input.classroomSlug?.trim() ?? '';
	if (!classroomName && !classroomSlug) {
		const classrooms = await listClassroomsByOrgSlug(organizationResult.organization.slug);
		const defaultClassroom = classrooms[0] ?? null;
		return {
			ok: defaultClassroom !== null,
			status: defaultClassroom ? 200 : 500,
			message: defaultClassroom
				? '組織を作成しました。初期教室はあとから設定できます。'
				: '初期教室の取得に失敗しました。',
			organization: organizationResult.organization,
			classroom: defaultClassroom
		};
	}
	if (!classroomName || !classroomSlug) {
		return {
			ok: false,
			status: 422,
			message: '初期教室を設定する場合は、教室名と slug の両方を入力してください。',
			organization: organizationResult.organization,
			classroom: null as ClassroomContextPayload | null
		};
	}

	const classroomResult = await updateClassroom(
		organizationResult.organization.slug,
		organizationResult.organization.slug,
		{
			name: classroomName,
			slug: classroomSlug
		}
	);
	if (!classroomResult.ok || !classroomResult.classroom) {
		return {
			ok: false,
			status: classroomResult.status,
			message: classroomResult.message,
			organization: organizationResult.organization,
			classroom: null as ClassroomContextPayload | null
		};
	}

	return {
		ok: true,
		status: classroomResult.status,
		message: '組織と初期教室を作成しました。',
		organization: organizationResult.organization,
		classroom: classroomResult.classroom
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

const asCreatedOrUpdatedClassroom = (value: unknown): ClassroomContextPayload | null =>
	asClassroomContextPayload(value as ClassroomPayload);

export const createClassroom = async (orgSlug: string, input: { name: string; slug: string }) => {
	const response = await authRpc.createClassroomByOrg(orgSlug, input);
	const payload = await parseResponseBody(response);
	const classroom = response.ok ? asCreatedOrUpdatedClassroom(payload) : null;
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok ? '教室を作成しました。' : toErrorMessage(payload, '教室の作成に失敗しました。'),
		classroom
	};
};

export const updateClassroom = async (
	orgSlug: string,
	classroomSlug: string,
	input: { name: string; slug: string }
) => {
	const response = await authRpc.updateClassroomByOrg(orgSlug, classroomSlug, input);
	const payload = await parseResponseBody(response);
	const classroom = response.ok ? asCreatedOrUpdatedClassroom(payload) : null;
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok ? '教室を更新しました。' : toErrorMessage(payload, '教室の更新に失敗しました。'),
		classroom
	};
};
