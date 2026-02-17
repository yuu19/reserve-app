import { authRpc, type OrganizationPayload } from '$lib/rpc-client';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isOrganizationPayload = (value: unknown): value is OrganizationPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.slug === 'string';

const asOrganizations = (value: unknown): OrganizationPayload[] =>
	Array.isArray(value) ? value.filter(isOrganizationPayload) : [];

const asOrganization = (value: unknown): OrganizationPayload | null =>
	isOrganizationPayload(value) ? value : null;

export const loadOrganizations = async () => {
	const [listResponse, activeResponse] = await Promise.all([
		authRpc.listOrganizations(),
		authRpc.getFullOrganization()
	]);
	const [listPayload, activePayload] = await Promise.all([
		parseResponseBody(listResponse),
		parseResponseBody(activeResponse)
	]);

	return {
		organizations: listResponse.ok ? asOrganizations(listPayload) : [],
		activeOrganization: activeResponse.ok ? asOrganization(activePayload) : null
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

export const setActiveOrganization = async (organizationId: string | null) => {
	const response = await authRpc.setActiveOrganization({ organizationId });
	const payload = await parseResponseBody(response);
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
