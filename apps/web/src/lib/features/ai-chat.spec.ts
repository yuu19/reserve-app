import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiChatResponse } from '@repo/saas-chatbot-core';
import { createAiChatState, type AiChatClient } from './ai-chat.svelte';

const createClientMock = (): AiChatClient => ({
	ask: vi.fn(),
	submitFeedback: vi.fn()
});

describe('ai-chat state', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('sends the current input and appends assistant responses with sources and actions', async () => {
		const client = createClientMock();
		vi.mocked(client.ask).mockResolvedValue({
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

		const state = createAiChatState(client);
		state.input = '予約枠を作るには？';
		await state.send({
			organizationId: 'org-a',
			classroomId: 'class-a',
			currentPage: '/admin/dashboard'
		});

		expect(client.ask).toHaveBeenCalledWith({
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
		const client = createClientMock();
		vi.mocked(client.ask).mockRejectedValue(new Error('AIサポートを利用できません。'));

		const state = createAiChatState(client);
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

	it('ignores stale responses after a conversation reset', async () => {
		const client = createClientMock();
		let resolveResponse: (response: AiChatResponse) => void = () => {};
		vi.mocked(client.ask).mockReturnValue(
			new Promise((resolve) => {
				resolveResponse = resolve;
			})
		);

		const state = createAiChatState(client);
		state.input = '切替前の質問';
		const sendPromise = state.send();
		state.resetConversation();

		resolveResponse({
			conversationId: 'conv-old',
			messageId: 'assistant-old',
			answer: '古い回答',
			sources: [],
			suggestedActions: [],
			confidence: 80,
			needsHumanSupport: false,
			rateLimit: {
				userRemainingThisHour: 19,
				organizationRemainingToday: 199
			}
		});
		await sendPromise;

		expect(state.messages).toEqual([]);
		expect(state.conversationId).toBeNull();
		expect(state.status).toBe('idle');
	});

	it('submits feedback and records failed feedback attempts', async () => {
		const client = createClientMock();
		const state = createAiChatState(client);
		state.messages = [
			{
				id: 'assistant-a',
				role: 'assistant',
				content: '回答',
				createdAt: new Date(),
				feedbackStatus: 'idle'
			}
		];

		vi.mocked(client.submitFeedback).mockResolvedValueOnce({
			feedbackId: 'feedback-a',
			messageId: 'assistant-a',
			rating: 'helpful'
		});
		await state.submitFeedback('assistant-a', 'helpful');

		expect(client.submitFeedback).toHaveBeenCalledWith('assistant-a', {
			rating: 'helpful',
			comment: undefined
		});
		expect(state.messages[0]).toMatchObject({
			feedbackRating: 'helpful',
			feedbackStatus: 'sent',
			feedbackError: null
		});

		vi.mocked(client.submitFeedback).mockRejectedValueOnce(new Error('送信失敗'));
		await state.submitFeedback('assistant-a', 'unhelpful', '根拠が足りない');

		expect(state.messages[0]).toMatchObject({
			feedbackRating: 'unhelpful',
			feedbackStatus: 'failed',
			feedbackError: '送信失敗'
		});
	});
});
