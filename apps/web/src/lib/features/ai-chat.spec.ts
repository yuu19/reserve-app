import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiChatResponse } from '@repo/saas-chatbot-core';
import { createAiClientError } from '$lib/ai-client';
import { createAiChatState, type AiChatClient } from './ai-chat.svelte';

const createClientMock = (): AiChatClient => ({
	ask: vi.fn(),
	submitFeedback: vi.fn()
});

describe('AI チャット状態', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('現在の入力を送信しソースとアクション付きのアシスタント回答を追加する', async () => {
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
		state.openConversation();
		state.input = '予約枠を作るには？';
		await state.send({
			organizationId: 'org-a',
			storeId: 'class-a',
			currentPage: '/admin/dashboard'
		});

		expect(client.ask).toHaveBeenCalledWith({
			message: '予約枠を作るには？',
			conversationId: undefined,
			organizationId: 'org-a',
			storeId: 'class-a',
			currentPage: '/admin/dashboard'
		});
		expect(state.conversationId).toBe('conv-a');
		expect(state.input).toBe('');
		expect(state.status).toBe('ready');
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

	it('チャットリクエスト失敗時に入力を復元し型付き API エラーを公開する', async () => {
		const client = createClientMock();
		vi.mocked(client.ask).mockRejectedValue(
			createAiClientError({
				kind: 'api',
				status: 429,
				message: 'AIサポートを利用できません。 5分後に再試行できます。',
				retryAfterSeconds: 300
			})
		);

		const state = createAiChatState(client);
		state.openConversation();
		state.input = 'エラーになる質問';
		await state.send();

		expect(state.error).toBe('AIサポートを利用できません。 5分後に再試行できます。');
		expect(state.status).toBe('error');
		expect(state.lastClientError).toMatchObject({
			kind: 'api',
			status: 429,
			retryAfterSeconds: 300
		});
		expect(state.input).toBe('エラーになる質問');
		expect(state.sending).toBe(false);
		expect(state.messages[0]).toMatchObject({
			role: 'user',
			content: 'エラーになる質問'
		});
	});

	it('チャットリクエスト接続不可時に入力を復元し型付きネットワークエラーを公開する', async () => {
		const client = createClientMock();
		vi.mocked(client.ask).mockRejectedValue(
			createAiClientError({
				kind: 'network',
				message: 'AIサポートへ接続できません。通信状態を確認してください。'
			})
		);

		const state = createAiChatState(client);
		state.openConversation();
		state.input = '通信失敗になる質問';
		await state.send();

		expect(state.error).toBe('AIサポートへ接続できません。通信状態を確認してください。');
		expect(state.status).toBe('error');
		expect(state.lastClientError).toMatchObject({ kind: 'network' });
		expect(state.input).toBe('通信失敗になる質問');
	});

	it('リセット時に会話スコープのチャットデータをクリアする', () => {
		const state = createAiChatState();
		state.openConversation();
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
		expect(state.status).toBe('ready');
		expect(state.error).toBeNull();
		expect(state.lastClientError).toBeNull();
		expect(state.lastRateLimit).toBeNull();
	});

	it('会話リセット後の古いレスポンスを無視する', async () => {
		const client = createClientMock();
		let resolveResponse: (response: AiChatResponse) => void = () => {};
		vi.mocked(client.ask).mockReturnValue(
			new Promise((resolve) => {
				resolveResponse = resolve;
			})
		);

		const state = createAiChatState(client);
		state.openConversation();
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
		expect(state.status).toBe('ready');
	});

	it('フィードバックを送信し失敗した試行を記録する', async () => {
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
