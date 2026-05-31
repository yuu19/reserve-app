import type {
	PublicSiteIntakeFieldsPayload,
	PublicSiteIntakeFieldPayload,
	ScopedApiContext,
	UpdatePublicSiteIntakeFieldsInput
} from '$lib/rpc-client';
import { authRpc } from '$lib/rpc-client';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

const isIntakeField = (value: unknown): value is PublicSiteIntakeFieldPayload =>
	isRecord(value) &&
	typeof value.fieldId === 'string' &&
	typeof value.label === 'string' &&
	(value.fieldType === 'text' ||
		value.fieldType === 'textarea' ||
		value.fieldType === 'select' ||
		value.fieldType === 'checkbox') &&
	typeof value.required === 'boolean' &&
	Array.isArray(value.options) &&
	value.options.every((option) => typeof option === 'string');

const isIntakeFieldsPayload = (value: unknown): value is PublicSiteIntakeFieldsPayload =>
	isRecord(value) && Array.isArray(value.fields) && value.fields.every(isIntakeField);

export const loadIntakeFields = async (
	context: ScopedApiContext
): Promise<PublicSiteIntakeFieldsPayload | null> => {
	const response = await authRpc.getPublicSiteIntakeFields(context);
	const payload = await parseResponseBody(response);
	if (!response.ok) {
		return null;
	}
	return isIntakeFieldsPayload(payload) ? payload : null;
};

export const updateIntakeFields = async (
	context: ScopedApiContext,
	input: UpdatePublicSiteIntakeFieldsInput
) => {
	const response = await authRpc.updatePublicSiteIntakeFields(context, input);
	const payload = await parseResponseBody(response);
	const fields = response.ok && isIntakeFieldsPayload(payload) ? payload : null;
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? 'カスタム入力を保存しました。'
			: toErrorMessage(payload, 'カスタム入力の保存に失敗しました。'),
		fields
	};
};
