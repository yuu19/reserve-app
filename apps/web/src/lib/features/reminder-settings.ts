import type {
	ReminderSettingsPayload,
	ScopedApiContext,
	UpdateReminderSettingsInput
} from '$lib/rpc-client';
import { authRpc } from '$lib/rpc-client';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

const isReminderSettingsPayload = (value: unknown): value is ReminderSettingsPayload => {
	if (!isRecord(value) || typeof value.enabled !== 'boolean' || !Array.isArray(value.timingsMinutes)) {
		return false;
	}
	return value.timingsMinutes.every((entry) => typeof entry === 'number');
};

export const loadReminderSettings = async (
	context: ScopedApiContext
): Promise<ReminderSettingsPayload | null> => {
	const response = await authRpc.getReminderSettings(context);
	const payload = await parseResponseBody(response);
	if (!response.ok) {
		return null;
	}
	return isReminderSettingsPayload(payload) ? payload : null;
};

export const updateReminderSettings = async (
	context: ScopedApiContext,
	input: UpdateReminderSettingsInput
) => {
	const response = await authRpc.updateReminderSettings(context, input);
	const payload = await parseResponseBody(response);
	const settings = response.ok && isReminderSettingsPayload(payload) ? payload : null;
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? 'リマインド設定を保存しました。'
			: toErrorMessage(payload, 'リマインド設定の保存に失敗しました。'),
		settings
	};
};
