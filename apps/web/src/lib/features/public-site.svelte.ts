import type {
	PublicSitePagePayload,
	PublicSiteProfilePayload,
	ScopedApiContext,
	UpdatePublicSiteSettingsInput
} from '$lib/rpc-client';
import { authRpc } from '$lib/rpc-client';
import { getPublicSitePage } from '$lib/remote/public-site-page.remote';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

const asPublicSiteProfile = (value: unknown): PublicSiteProfilePayload | null => {
	if (
		!isRecord(value) ||
		typeof value.organizationId !== 'string' ||
		typeof value.organizationSlug !== 'string' ||
		typeof value.organizationName !== 'string' ||
		typeof value.classroomId !== 'string' ||
		typeof value.classroomSlug !== 'string' ||
		typeof value.classroomName !== 'string' ||
		typeof value.siteName !== 'string'
	) {
		return null;
	}
	return value as PublicSiteProfilePayload;
};

export const loadPublicSitePage = async (
	context: ScopedApiContext
): Promise<PublicSitePagePayload> => {
	return getPublicSitePage(context);
};

export const loadPublicSiteSettings = async (
	context: ScopedApiContext
): Promise<PublicSiteProfilePayload | null> => {
	const response = await authRpc.getPublicSiteSettings(context);
	const payload = await parseResponseBody(response);
	if (!response.ok) {
		return null;
	}
	return asPublicSiteProfile(payload);
};

export const updatePublicSiteSettings = async (
	context: ScopedApiContext,
	input: UpdatePublicSiteSettingsInput
) => {
	const response = await authRpc.updatePublicSiteSettings(context, input);
	const payload = await parseResponseBody(response);
	const publicSite = response.ok ? asPublicSiteProfile(payload) : null;
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? '予約サイトトップページを更新しました。'
			: toErrorMessage(payload, '予約サイトトップページの更新に失敗しました。'),
		publicSite
	};
};
