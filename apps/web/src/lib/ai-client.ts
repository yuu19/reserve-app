import { authRpc } from '$lib/rpc-client';
import type {
	AiChatClientErrorPayload,
	AiChatRequest,
	AiChatResponse,
	AiFeedbackRequest,
	AiFeedbackResponse
} from '@repo/saas-chatbot-core';

export type {
	AiChatContext,
	AiChatClientErrorPayload,
	AiChatMessage,
	AiChatRequest,
	AiChatResponse,
	AiChatUiStatus,
	AiFeedbackRequest,
	AiFeedbackResponse,
	AiFeedbackRating,
	AiSourceKind,
	AiSourceReference,
	AiSourceVisibility,
	AiSuggestedAction,
	AiSuggestedActionKind
} from '@repo/saas-chatbot-core';

export class AiClientError extends Error {
	readonly payload: AiChatClientErrorPayload;

	constructor(payload: AiChatClientErrorPayload) {
		super(payload.message);
		this.name = 'AiClientError';
		this.payload = payload;
	}
}

export const createAiClientError = (payload: AiChatClientErrorPayload): AiClientError =>
	new AiClientError(payload);

export const isAiClientError = (error: unknown): error is AiClientError =>
	error instanceof AiClientError;

export const getAiClientErrorPayload = (
	error: unknown,
	fallbackMessage: string
): AiChatClientErrorPayload => {
	if (isAiClientError(error)) {
		return error.payload;
	}
	return {
		kind: 'network',
		message: error instanceof Error && error.message.length > 0 ? error.message : fallbackMessage
	};
};

const parseJsonResponse = async (
	response: Response,
	parseErrorMessage: string
): Promise<unknown> => {
	// backend は rate limit や認可失敗で JSON 以外を返す可能性があるため、UI 側では
	// 失敗時メッセージを作れる形に丸める。
	const contentType = response.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		try {
			return await response.json();
		} catch {
			throw createAiClientError({
				kind: 'parse',
				message: parseErrorMessage,
				status: response.status,
				statusText: response.statusText || undefined
			});
		}
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const readErrorMessage = (payload: unknown, fallback: string): string => {
	if (isRecord(payload) && typeof payload.message === 'string' && payload.message.length > 0) {
		return payload.message;
	}
	return fallback;
};

const readRetryAfterSeconds = (payload: unknown): number | undefined =>
	isRecord(payload) && typeof payload.retryAfterSeconds === 'number'
		? payload.retryAfterSeconds
		: undefined;

const appendRetryAfterMessage = (message: string, retryAfterSeconds: number | undefined): string =>
	typeof retryAfterSeconds === 'number'
		? `${message} ${Math.ceil(retryAfterSeconds / 60)}分後に再試行できます。`
		: message;

const postJson = async (
	path: string,
	request: unknown,
	options: {
		apiErrorMessage: string;
		networkErrorMessage: string;
		parseErrorMessage: string;
	}
): Promise<unknown> => {
	let response: Response;
	try {
		response = await fetch(new URL(path, authRpc.backendUrl), {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify(request),
			credentials: 'include'
		});
	} catch {
		throw createAiClientError({
			kind: 'network',
			message: options.networkErrorMessage
		});
	}

	const payload = await parseJsonResponse(response, options.parseErrorMessage);
	if (!response.ok) {
		const retryAfterSeconds = readRetryAfterSeconds(payload);
		throw createAiClientError({
			kind: 'api',
			message: appendRetryAfterMessage(
				readErrorMessage(payload, options.apiErrorMessage),
				retryAfterSeconds
			),
			status: response.status,
			statusText: response.statusText || undefined,
			retryAfterSeconds
		});
	}
	return payload;
};

/** 認証 cookie を付けて AI chat API を呼び、rate limit の再試行目安をエラーメッセージに含める。 */
export const askAi = async (request: AiChatRequest): Promise<AiChatResponse> => {
	const payload = await postJson('/api/v1/ai/chat', request, {
		apiErrorMessage: 'AIサポートを利用できません。',
		networkErrorMessage: 'AIサポートへ接続できません。通信状態を確認してください。',
		parseErrorMessage: 'AIサポートの応答を解析できません。時間をおいて再試行してください。'
	});
	return payload as AiChatResponse;
};

/** assistant message に対する feedback を送信する。失敗時は state 側が再試行表示できる例外にする。 */
export const submitAiFeedback = async (
	messageId: string,
	request: AiFeedbackRequest
): Promise<AiFeedbackResponse> => {
	const payload = await postJson(
		`/api/v1/ai/messages/${encodeURIComponent(messageId)}/feedback`,
		request,
		{
			apiErrorMessage: 'フィードバックを送信できません。',
			networkErrorMessage: 'フィードバックへ接続できません。通信状態を確認してください。',
			parseErrorMessage: 'フィードバック送信結果を解析できません。時間をおいて再試行してください。'
		}
	);
	return payload as AiFeedbackResponse;
};
