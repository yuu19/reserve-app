import {
	askAi,
	submitAiFeedback,
	type AiChatResponse,
	type AiSourceReference,
	type AiSuggestedAction
} from '$lib/ai-client';
import { SvelteDate } from 'svelte/reactivity';

export type AiChatMessage = {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	sources?: AiSourceReference[];
	suggestedActions?: AiSuggestedAction[];
	confidence?: number;
	needsHumanSupport?: boolean;
	feedbackRating?: 'helpful' | 'unhelpful' | null;
	feedbackStatus?: 'idle' | 'sending' | 'sent' | 'failed';
	feedbackError?: string | null;
	createdAt: Date;
};

export type AiChatContext = {
	organizationId?: string | null;
	classroomId?: string | null;
	currentPage?: string | null;
};

export class AiChatState {
	messages = $state<AiChatMessage[]>([]);
	input = $state('');
	conversationId = $state<string | null>(null);
	sending = $state(false);
	error = $state<string | null>(null);
	lastRateLimit = $state<AiChatResponse['rateLimit'] | null>(null);

	get canSend() {
		return this.input.trim().length > 0 && this.input.length <= 4000 && !this.sending;
	}

	get inputError() {
		if (this.input.length > 4000) {
			return '4000文字以内で入力してください。';
		}
		return null;
	}

	resetConversation() {
		this.messages = [];
		this.input = '';
		this.conversationId = null;
		this.error = null;
		this.lastRateLimit = null;
	}

	async send(context: AiChatContext = {}) {
		const message = this.input.trim();
		if (!message || this.inputError || this.sending) {
			return;
		}

		this.error = null;
		this.sending = true;
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
			const response = await askAi({
				message,
				conversationId: this.conversationId ?? undefined,
				organizationId: context.organizationId ?? undefined,
				classroomId: context.classroomId ?? undefined,
				currentPage: context.currentPage ?? undefined
			});
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
			this.error = error instanceof Error ? error.message : 'AIサポートを利用できません。';
			this.input = message;
		} finally {
			this.sending = false;
		}
	}

	async submitFeedback(messageId: string, rating: 'helpful' | 'unhelpful', comment?: string) {
		this.messages = this.messages.map((message) =>
			message.id === messageId
				? { ...message, feedbackRating: rating, feedbackStatus: 'sending', feedbackError: null }
				: message
		);

		try {
			await submitAiFeedback(messageId, { rating, comment });
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

export const createAiChatState = () => new AiChatState();
