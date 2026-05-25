import { askAi, submitAiFeedback } from '$lib/ai-client';
import type {
	AiChatContext,
	AiChatMessage,
	AiChatRequest,
	AiChatResponse,
	AiFeedbackRequest,
	AiFeedbackRating,
	AiFeedbackResponse
} from '@repo/saas-chatbot-core';
import { SvelteDate } from 'svelte/reactivity';

export type { AiChatContext, AiChatMessage } from '@repo/saas-chatbot-core';

export type AiChatClient = {
	ask(request: AiChatRequest): Promise<AiChatResponse>;
	submitFeedback(messageId: string, request: AiFeedbackRequest): Promise<AiFeedbackResponse>;
};

type AiChatStatus = 'idle' | 'sending';

const defaultAiChatClient: AiChatClient = {
	ask: askAi,
	submitFeedback: submitAiFeedback
};

export class AiChatState {
	messages = $state<AiChatMessage[]>([]);
	input = $state('');
	conversationId = $state<string | null>(null);
	status = $state<AiChatStatus>('idle');
	error = $state<string | null>(null);
	lastRateLimit = $state<AiChatResponse['rateLimit'] | null>(null);
	#client: AiChatClient;
	#conversationVersion = 0;

	constructor(client: AiChatClient = defaultAiChatClient) {
		this.#client = client;
	}

	get sending() {
		return this.status === 'sending';
	}

	get canSend() {
		return this.input.trim().length > 0 && this.input.length <= 4000 && this.status !== 'sending';
	}

	get inputError() {
		if (this.input.length > 4000) {
			return '4000文字以内で入力してください。';
		}
		return null;
	}

	resetConversation() {
		// conversationId を破棄して、次の送信を backend 上でも新しい会話として扱う。
		this.#conversationVersion += 1;
		this.messages = [];
		this.input = '';
		this.conversationId = null;
		this.status = 'idle';
		this.error = null;
		this.lastRateLimit = null;
	}

	async send(context: AiChatContext = {}) {
		const message = this.input.trim();
		if (!message || this.inputError || this.sending) {
			return;
		}
		const conversationVersion = this.#conversationVersion;

		this.error = null;
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
				classroomId: context.classroomId ?? undefined,
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
			this.error = error instanceof Error ? error.message : 'AIサポートを利用できません。';
			this.input = message;
		} finally {
			if (conversationVersion === this.#conversationVersion) {
				this.status = 'idle';
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
			this.messages = this.messages.map((message) =>
				message.id === messageId
					? {
							...message,
							feedbackStatus: 'failed',
							feedbackError:
								error instanceof Error ? error.message : 'フィードバックを送信できません。'
						}
					: message
			);
		}
	}
}

/** Svelte component から runes state を直接 new せずに作れるようにする factory。 */
export const createAiChatState = (client?: AiChatClient) => new AiChatState(client);
