import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiChatState } from './ai-chat.svelte';

const mocks = vi.hoisted(() => ({
	askAi: vi.fn(),
	submitAiFeedback: vi.fn()
}));

vi.mock('$lib/ai-client', () => ({
	askAi: mocks.askAi,
	submitAiFeedback: mocks.submitAiFeedback
}));

describe('ai-chat state', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		mocks.askAi.mockReset();
		mocks.submitAiFeedback.mockReset();
	});

	it('sends the current input and appends assistant responses with sources and actions', async () => {
		mocks.askAi.mockResolvedValue({
			conversationId: 'conv-a',
			messageId: 'msg-assistant-a',
			answer: '予約運用から予約枠を作成できます。',
			sources: [{ sourceKind: 'docs', title: '予約運用', chunkId: 'chunk-a' }],
			suggestedActions: [
				{ label: '予約運用を開く', href: '/admin/bookings', actionKind: 'open_page' }
			],
			confidence: 82,
			needsHumanSupport: false,
			rateLimit: {
				userRemainingThisHour: 19,
				organizationRemainingToday: 199
			}
		});

		const state = createAiChatState();
		state.input = '予約枠を作るには？';
		await state.send({
			organizationId: 'org-a',
			classroomId: 'class-a',
			currentPage: '/admin/dashboard'
		});

		expect(mocks.askAi).toHaveBeenCalledWith({
			message: '予約枠を作るには？',
			conversationId: undefined,
			organizationId: 'org-a',
			classroomId: 'class-a',
			currentPage: '/admin/dashboard'
		});
		expect(state.conversationId).toBe('conv-a');
		expect(state.input).toBe('');
		expect(state.messages).toHaveLength(2);
		expect(state.messages[1]).toMatchObject({
			id: 'msg-assistant-a',
			role: 'assistant',
			content: '予約運用から予約枠を作成できます。',
			confidence: 82,
			needsHumanSupport: false,
			feedbackStatus: 'idle'
		});
		expect(state.lastRateLimit).toEqual({
			userRemainingThisHour: 19,
			organizationRemainingToday: 199
		});
	});

	it('restores input and exposes an error when the chat request fails', async () => {
		mocks.askAi.mockRejectedValue(new Error('AIサポートを利用できません。'));

		const state = createAiChatState();
		state.input = 'エラーになる質問';
		await state.send();

		expect(state.error).toBe('AIサポートを利用できません。');
		expect(state.input).toBe('エラーになる質問');
		expect(state.sending).toBe(false);
		expect(state.messages[0]).toMatchObject({
			role: 'user',
			content: 'エラーになる質問'
		});
	});

	it('clears conversation-scoped chat data when reset', () => {
		const state = createAiChatState();
		state.messages = [
			{
				id: 'assistant-a',
				role: 'assistant',
				content: '回答',
				createdAt: new Date(),
				feedbackStatus: 'idle'
			}
		];
		state.input = '入力中';
		state.conversationId = 'conv-a';
		state.error = 'エラー';
		state.lastRateLimit = {
			userRemainingThisHour: 10,
			organizationRemainingToday: 100
		};

		state.resetConversation();

		expect(state.messages).toEqual([]);
		expect(state.input).toBe('');
		expect(state.conversationId).toBeNull();
		expect(state.error).toBeNull();
		expect(state.lastRateLimit).toBeNull();
	});

	it('submits feedback and records failed feedback attempts', async () => {
		const state = createAiChatState();
		state.messages = [
			{
				id: 'assistant-a',
				role: 'assistant',
				content: '回答',
				createdAt: new Date(),
				feedbackStatus: 'idle'
			}
		];

		mocks.submitAiFeedback.mockResolvedValueOnce({
			feedbackId: 'feedback-a',
			messageId: 'assistant-a',
			rating: 'helpful'
		});
		await state.submitFeedback('assistant-a', 'helpful');

		expect(mocks.submitAiFeedback).toHaveBeenCalledWith('assistant-a', {
			rating: 'helpful',
			comment: undefined
		});
		expect(state.messages[0]).toMatchObject({
			feedbackRating: 'helpful',
			feedbackStatus: 'sent',
			feedbackError: null
		});

		mocks.submitAiFeedback.mockRejectedValueOnce(new Error('送信失敗'));
		await state.submitFeedback('assistant-a', 'unhelpful', '根拠が足りない');

		expect(state.messages[0]).toMatchObject({
			feedbackRating: 'unhelpful',
			feedbackStatus: 'failed',
			feedbackError: '送信失敗'
		});
	});
});
