import { afterEach, describe, expect, it, vi } from 'vitest';
import { askAi, isAiClientError, submitAiFeedback } from './ai-client';

describe('ai-client', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('throws a typed API error and preserves retry metadata', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				return new Response(
					JSON.stringify({
						message: 'AIサポートを利用できません。',
						retryAfterSeconds: 120
					}),
					{
						status: 429,
						statusText: 'Too Many Requests',
						headers: { 'content-type': 'application/json' }
					}
				);
			})
		);

		await expect(askAi({ message: '予約枠を作るには？' })).rejects.toMatchObject({
			payload: {
				kind: 'api',
				status: 429,
				statusText: 'Too Many Requests',
				retryAfterSeconds: 120,
				message: 'AIサポートを利用できません。 2分後に再試行できます。'
			}
		});
	});

	it('throws a typed network error when fetch fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('failed to fetch');
			})
		);

		try {
			await askAi({ message: '通信失敗になる質問' });
			throw new Error('Expected askAi to throw');
		} catch (error) {
			expect(isAiClientError(error)).toBe(true);
			if (isAiClientError(error)) {
				expect(error.payload).toMatchObject({
					kind: 'network',
					message: 'AIサポートへ接続できません。通信状態を確認してください。'
				});
			}
		}
	});

	it('throws a typed parse error when a success response cannot be parsed', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				return new Response('{', {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);

		await expect(askAi({ message: '壊れた応答' })).rejects.toMatchObject({
			payload: {
				kind: 'parse',
				status: 200,
				message: 'AIサポートの応答を解析できません。時間をおいて再試行してください。'
			}
		});
	});

	it('uses feedback-specific typed API errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				return new Response(JSON.stringify({ message: 'フィードバックを送信できません。' }), {
					status: 403,
					statusText: 'Forbidden',
					headers: { 'content-type': 'application/json' }
				});
			})
		);

		await expect(submitAiFeedback('assistant-a', { rating: 'helpful' })).rejects.toMatchObject({
			payload: {
				kind: 'api',
				status: 403,
				statusText: 'Forbidden',
				message: 'フィードバックを送信できません。'
			}
		});
	});
});
