import { askAi, getAiClientErrorPayload, submitAiFeedback } from '$lib/ai-client';
import type {
	AiChatClientErrorPayload,
	AiChatContext,
	AiChatMessage,
	AiChatRequest,
	AiChatResponse,
	AiChatUiStatus,
	AiFeedbackRequest,
	AiFeedbackRating,
	AiFeedbackResponse
} from '@repo/saas-chatbot-core';
import { SvelteDate } from 'svelte/reactivity';

export type {
	AiChatClientErrorPayload,
	AiChatContext,
	AiChatMessage,
	AiChatUiStatus
} from '@repo/saas-chatbot-core';

export type AiChatClient = {
	ask(request: AiChatRequest): Promise<AiChatResponse>;
	submitFeedback(messageId: string, request: AiFeedbackRequest): Promise<AiFeedbackResponse>;
};

const defaultAiChatClient: AiChatClient = {
	ask: askAi,
	submitFeedback: submitAiFeedback
};

export class AiChatState {
	messages = $state<AiChatMessage[]>([]);
	input = $state('');
	conversationId = $state<string | null>(null);
	status = $state<AiChatUiStatus>('closed');
	error = $state<string | null>(null);
	lastClientError = $state<AiChatClientErrorPayload | null>(null);
	lastRateLimit = $state<AiChatResponse['rateLimit'] | null>(null);
	#client: AiChatClient;
	#conversationVersion = 0;

	constructor(client: AiChatClient = defaultAiChatClient) {
		this.#client = client;
	}

	get open() {
		return this.status !== 'closed';
	}

	get sending() {
		return this.status === 'sending';
	}

	get canSend() {
		return this.open && this.input.trim().length > 0 && this.input.length <= 4000 && !this.sending;
	}

	get inputError() {
		if (this.input.length > 4000) {
			return '4000文字以内で入力してください。';
		}
		return null;
	}

	openConversation() {
		if (this.status === 'closed') {
			this.status = this.error ? 'error' : 'ready';
		}
	}

	closeConversation() {
		this.status = 'closed';
	}

	resetConversation() {
		const wasOpen = this.open;
		this.#conversationVersion += 1;
		this.messages = [];
		this.input = '';
		this.conversationId = null;
		this.status = wasOpen ? 'ready' : 'closed';
		this.error = null;
		this.lastClientError = null;
		this.lastRateLimit = null;
	}

	async send(context: AiChatContext = {}) {
		const message = this.input.trim();
		if (!message || this.inputError || !this.canSend) {
			return;
		}
		const conversationVersion = this.#conversationVersion;

		this.error = null;
		this.lastClientError = null;
		this.status = 'sending';
		this.input = '';
		this.messages = [
			...this.messages,
			{
				id: crypto.randomUUID(),
				role: 'user',
				content: message,
				createdAt: new SvelteDate()
			}
		];

		try {
			// 楽観的にユーザーメッセージを表示してから送信し、失敗時は入力欄へ戻して再送できるようにする。
			const response = await this.#client.ask({
				message,
				conversationId: this.conversationId ?? undefined,
				organizationId: context.organizationId ?? undefined,
				storeId: context.storeId ?? undefined,
				currentPage: context.currentPage ?? undefined
			});
			if (conversationVersion !== this.#conversationVersion) {
				return;
			}
			this.conversationId = response.conversationId;
			this.lastRateLimit = response.rateLimit ?? null;
			this.messages = [
				...this.messages,
				{
					id: response.messageId,
					role: 'assistant',
					content: response.answer,
					sources: response.sources,
					suggestedActions: response.suggestedActions,
					confidence: response.confidence,
					needsHumanSupport: response.needsHumanSupport,
					feedbackRating: null,
					feedbackStatus: 'idle',
					createdAt: new SvelteDate()
				}
			];
		} catch (error) {
			if (conversationVersion !== this.#conversationVersion) {
				return;
			}
			const payload = getAiClientErrorPayload(error, 'AIサポートを利用できません。');
			this.error = payload.message;
			this.lastClientError = payload;
			this.input = message;
		} finally {
			if (conversationVersion === this.#conversationVersion && this.status === 'sending') {
				this.status = this.error ? 'error' : 'ready';
			}
		}
	}

	async submitFeedback(messageId: string, rating: AiFeedbackRating, comment?: string) {
		// feedback はメッセージ単位の状態だけを先に更新し、他の会話履歴は immutable に保つ。
		this.messages = this.messages.map((message) =>
			message.id === messageId
				? { ...message, feedbackRating: rating, feedbackStatus: 'sending', feedbackError: null }
				: message
		);

		try {
			await this.#client.submitFeedback(messageId, { rating, comment });
			this.messages = this.messages.map((message) =>
				message.id === messageId
					? { ...message, feedbackRating: rating, feedbackStatus: 'sent', feedbackError: null }
					: message
			);
		} catch (error) {
			const payload = getAiClientErrorPayload(error, 'フィードバックを送信できません。');
			this.messages = this.messages.map((message) =>
				message.id === messageId
					? {
							...message,
							feedbackStatus: 'failed',
							feedbackError: payload.message
						}
					: message
			);
		}
	}
}

/** Svelte component から runes state を直接 new せずに作れるようにする factory。 */
export const createAiChatState = (client?: AiChatClient) => new AiChatState(client);
