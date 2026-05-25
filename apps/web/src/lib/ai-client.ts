import { authRpc } from '$lib/rpc-client';
import type {
	AiChatRequest,
	AiChatResponse,
	AiFeedbackRequest,
	AiFeedbackResponse
} from '@repo/saas-chatbot-core';

export type {
	AiChatContext,
	AiChatMessage,
	AiChatRequest,
	AiChatResponse,
	AiFeedbackRequest,
	AiFeedbackResponse,
	AiFeedbackRating,
	AiSourceKind,
	AiSourceReference,
	AiSourceVisibility,
	AiSuggestedAction,
	AiSuggestedActionKind
} from '@repo/saas-chatbot-core';

const parseJsonResponse = async (response: Response): Promise<unknown> => {
	// backend は rate limit や認可失敗で JSON 以外を返す可能性があるため、UI 側では
	// 失敗時メッセージを作れる形に丸める。
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const readErrorMessage = (payload: unknown, fallback: string): string => {
	if (isRecord(payload) && typeof payload.message === 'string' && payload.message.length > 0) {
		return payload.message;
	}
	return fallback;
};

/** 認証 cookie を付けて AI chat API を呼び、rate limit の再試行目安をエラーメッセージに含める。 */
export const askAi = async (request: AiChatRequest): Promise<AiChatResponse> => {
	const response = await fetch(new URL('/api/v1/ai/chat', authRpc.backendUrl), {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify(request),
		credentials: 'include'
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		const retryAfter =
			isRecord(payload) && typeof payload.retryAfterSeconds === 'number'
				? ` ${Math.ceil(payload.retryAfterSeconds / 60)}分後に再試行できます。`
				: '';
		throw new Error(readErrorMessage(payload, 'AIサポートを利用できません。') + retryAfter);
	}
	return payload as AiChatResponse;
};

/** assistant message に対する feedback を送信する。失敗時は state 側が再試行表示できる例外にする。 */
export const submitAiFeedback = async (
	messageId: string,
	request: AiFeedbackRequest
): Promise<AiFeedbackResponse> => {
	const response = await fetch(
		new URL(`/api/v1/ai/messages/${encodeURIComponent(messageId)}/feedback`, authRpc.backendUrl),
		{
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify(request),
			credentials: 'include'
		}
	);
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(readErrorMessage(payload, 'フィードバックを送信できません。'));
	}
	return payload as AiFeedbackResponse;
};
