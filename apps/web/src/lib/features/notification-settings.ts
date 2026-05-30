import type {
	NotificationSettingsPayload,
	ScopedApiContext,
	UpdateNotificationSettingsInput
} from '$lib/rpc-client';
import { authRpc } from '$lib/rpc-client';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

const isNotificationSettingsPayload = (value: unknown): value is NotificationSettingsPayload => {
	if (
		!isRecord(value) ||
		typeof value.notifyOwner !== 'boolean' ||
		typeof value.notifyAdmins !== 'boolean' ||
		typeof value.notifyStoreManagers !== 'boolean' ||
		typeof value.notifyStaff !== 'boolean' ||
		!Array.isArray(value.additionalEmails)
	) {
		return false;
	}
	return value.additionalEmails.every((entry) => typeof entry === 'string');
};

export const loadNotificationSettings = async (
	context: ScopedApiContext
): Promise<NotificationSettingsPayload | null> => {
	const response = await authRpc.getNotificationSettings(context);
	const payload = await parseResponseBody(response);
	if (!response.ok) {
		return null;
	}
	return isNotificationSettingsPayload(payload) ? payload : null;
};

export const updateNotificationSettings = async (
	context: ScopedApiContext,
	input: UpdateNotificationSettingsInput
) => {
	const response = await authRpc.updateNotificationSettings(context, input);
	const payload = await parseResponseBody(response);
	const settings = response.ok && isNotificationSettingsPayload(payload) ? payload : null;
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? '通知先設定を保存しました。'
			: toErrorMessage(payload, '通知先設定の保存に失敗しました。'),
		settings
	};
};
