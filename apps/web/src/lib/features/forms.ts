import type {
	CreateFormAssignmentInput,
	CreateFormInput,
	FormAssignmentPayload,
	FormListPayload,
	FormPayload,
	FormSubmissionDetailPayload,
	FormSubmissionsPayload,
	RequiredFormsPayload,
	RequiredFormsQuery,
	ScopedApiContext,
	UpdateFormInput
} from '$lib/rpc-client';
import { authRpc } from '$lib/rpc-client';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

const isForm = (value: unknown): value is FormPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	(value.formType === 'reservation_input' ||
		value.formType === 'pre_survey' ||
		value.formType === 'consent') &&
	typeof value.name === 'string' &&
	(value.status === 'draft' || value.status === 'published' || value.status === 'archived') &&
	Array.isArray(value.fields) &&
	Array.isArray(value.assignments);

const isFormList = (value: unknown): value is FormListPayload =>
	isRecord(value) && Array.isArray(value.forms) && value.forms.every(isForm);

const isAssignment = (value: unknown): value is FormAssignmentPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	(value.targetType === 'store' || value.targetType === 'service' || value.targetType === 'slot') &&
	typeof value.targetId === 'string';

const isAssignmentList = (value: unknown): value is { assignments: FormAssignmentPayload[] } =>
	isRecord(value) && Array.isArray(value.assignments) && value.assignments.every(isAssignment);

const isSubmissions = (value: unknown): value is FormSubmissionsPayload =>
	isRecord(value) && Array.isArray(value.submissions);

const isSubmissionDetail = (value: unknown): value is FormSubmissionDetailPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.formName === 'string' &&
	typeof value.versionNumber === 'number' &&
	Array.isArray(value.answers);

const isRequiredForms = (value: unknown): value is RequiredFormsPayload =>
	isRecord(value) && typeof value.formContextHash === 'string' && Array.isArray(value.forms);

const resultMessage = (response: Response, payload: unknown, success: string, fallback: string) =>
	response.ok ? success : toErrorMessage(payload, fallback);

export const loadForms = async (context: ScopedApiContext): Promise<FormListPayload> => {
	const response = await authRpc.listFormsScoped(context);
	const payload = await parseResponseBody(response);
	if (!response.ok || !isFormList(payload)) {
		throw new Error(toErrorMessage(payload, '予約フォーム設定一覧の取得に失敗しました。'));
	}
	return payload;
};

export const loadForm = async (
	context: ScopedApiContext,
	formId: string
): Promise<FormPayload | null> => {
	const response = await authRpc.getFormScoped(context, formId);
	const payload = await parseResponseBody(response);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok || !isForm(payload)) {
		throw new Error(toErrorMessage(payload, '予約フォーム設定の取得に失敗しました。'));
	}
	return payload;
};

export const createForm = async (context: ScopedApiContext, input: CreateFormInput) => {
	const response = await authRpc.createFormScoped(context, input);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		form: response.ok && isForm(payload) ? payload : null,
		message: resultMessage(
			response,
			payload,
			'予約フォーム設定を作成しました。',
			'予約フォーム設定の作成に失敗しました。'
		)
	};
};

export const updateForm = async (
	context: ScopedApiContext,
	formId: string,
	input: UpdateFormInput
) => {
	const response = await authRpc.updateFormScoped(context, formId, input);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		form: response.ok && isForm(payload) ? payload : null,
		message: resultMessage(
			response,
			payload,
			'予約フォーム設定を保存しました。',
			'予約フォーム設定の保存に失敗しました。'
		)
	};
};

export const publishForm = async (context: ScopedApiContext, formId: string) => {
	const response = await authRpc.publishFormScoped(context, formId);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		form: response.ok && isForm(payload) ? payload : null,
		message: resultMessage(
			response,
			payload,
			'予約フォーム設定を公開しました。',
			'予約フォーム設定の公開に失敗しました。'
		)
	};
};

export const archiveForm = async (context: ScopedApiContext, formId: string) => {
	const response = await authRpc.archiveFormScoped(context, formId);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		form: response.ok && isForm(payload) ? payload : null,
		message: resultMessage(
			response,
			payload,
			'予約フォーム設定をアーカイブしました。',
			'予約フォーム設定のアーカイブに失敗しました。'
		)
	};
};

export const createFormAssignment = async (
	context: ScopedApiContext,
	formId: string,
	input: CreateFormAssignmentInput
) => {
	const response = await authRpc.createFormAssignmentScoped(context, formId, input);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		assignments: response.ok && isAssignmentList(payload) ? payload.assignments : null,
		message: resultMessage(
			response,
			payload,
			'表示対象の詳細設定を保存しました。',
			'表示対象の詳細設定に失敗しました。'
		)
	};
};

export const deleteFormAssignment = async (
	context: ScopedApiContext,
	formId: string,
	assignmentId: string
) => {
	const response = await authRpc.deleteFormAssignmentScoped(context, formId, assignmentId);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		assignments: response.ok && isAssignmentList(payload) ? payload.assignments : null,
		message: resultMessage(
			response,
			payload,
			'表示対象の詳細設定を解除しました。',
			'表示対象の詳細設定解除に失敗しました。'
		)
	};
};

export const loadFormSubmissions = async (
	context: ScopedApiContext,
	formId: string
): Promise<FormSubmissionsPayload> => {
	const response = await authRpc.listFormSubmissionsScoped(context, formId);
	const payload = await parseResponseBody(response);
	if (!response.ok || !isSubmissions(payload)) {
		throw new Error(toErrorMessage(payload, 'フォーム回答の取得に失敗しました。'));
	}
	return payload;
};

export const loadFormSubmissionDetail = async (
	context: ScopedApiContext,
	submissionId: string
): Promise<FormSubmissionDetailPayload | null> => {
	const response = await authRpc.getFormSubmissionScoped(context, submissionId);
	const payload = await parseResponseBody(response);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok || !isSubmissionDetail(payload)) {
		throw new Error(toErrorMessage(payload, 'フォーム回答詳細の取得に失敗しました。'));
	}
	return payload;
};

export const loadRequiredForms = async (
	context: ScopedApiContext,
	query?: RequiredFormsQuery
): Promise<RequiredFormsPayload> => {
	const response = await authRpc.getPublicRequiredForms(context, query);
	const payload = await parseResponseBody(response);
	if (!response.ok || !isRequiredForms(payload)) {
		throw new Error(toErrorMessage(payload, '予約フォームの取得に失敗しました。'));
	}
	return payload;
};

export const loadRequiredFormsForStaff = async (
	context: ScopedApiContext,
	query?: RequiredFormsQuery
): Promise<RequiredFormsPayload> => {
	const response = await authRpc.getRequiredFormsScoped(context, query);
	const payload = await parseResponseBody(response);
	if (!response.ok || !isRequiredForms(payload)) {
		throw new Error(toErrorMessage(payload, '予約フォームの取得に失敗しました。'));
	}
	return payload;
};
