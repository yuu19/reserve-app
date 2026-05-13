import { authRpc } from '$lib/rpc-client';

export type AiSourceKind = 'docs' | 'specs' | 'faq' | 'db_summary';
export type AiSuggestedActionKind = 'open_page' | 'contact_owner' | 'contact_support';

export type AiSourceReference = {
	sourceKind: AiSourceKind;
	title: string;
	sourcePath?: string | null;
	chunkId?: string | null;
	visibility?: 'public' | 'authenticated' | 'participant' | 'staff' | 'manager' | 'admin' | 'owner';
};

export type AiSuggestedAction = {
	label: string;
	href?: string | null;
	actionKind: AiSuggestedActionKind;
};

export type AiChatResponse = {
	conversationId: string;
	messageId: string;
	answer: string;
	sources: AiSourceReference[];
	suggestedActions: AiSuggestedAction[];
	confidence: number;
	needsHumanSupport: boolean;
	rateLimit?: {
		userRemainingThisHour: number;
		organizationRemainingToday: number;
	};
};

export type AiChatRequest = {
	message: string;
	conversationId?: string;
	organizationId?: string;
	classroomId?: string;
	currentPage?: string;
};

export type AiFeedbackRequest = {
	rating: 'helpful' | 'unhelpful';
	comment?: string;
};

const parseJsonResponse = async (response: Response): Promise<unknown> => {
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

export const submitAiFeedback = async (
	messageId: string,
	request: AiFeedbackRequest
): Promise<{ feedbackId: string; messageId: string; rating: 'helpful' | 'unhelpful' }> => {
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
	return payload as { feedbackId: string; messageId: string; rating: 'helpful' | 'unhelpful' };
};
