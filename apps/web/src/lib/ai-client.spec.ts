import { afterEach, describe, expect, it, vi } from 'vitest';
import { askAi, isAiClientError, submitAiFeedback } from './ai-client';

describe('AI クライアント', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('型付き API エラーを投げ再試行メタデータを保持する', async () => {
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

	it('fetch 失敗時に型付きネットワークエラーを投げる', async () => {
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

	it('成功レスポンスを解析できない場合に型付き parse エラーを投げる', async () => {
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

	it('フィードバック専用の型付き API エラーを使う', async () => {
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
