import { page } from 'vitest/browser';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AiChatWidget from './AiChatWidget.svelte';

const mocks = vi.hoisted(() => ({
	askAi: vi.fn(),
	submitAiFeedback: vi.fn()
}));

vi.mock('$lib/ai-client', () => ({
	askAi: mocks.askAi,
	submitAiFeedback: mocks.submitAiFeedback,
	getAiClientErrorPayload: (error: unknown, fallbackMessage: string) => ({
		kind: 'network',
		message: error instanceof Error && error.message.length > 0 ? error.message : fallbackMessage
	})
}));

describe('AiChatWidget.svelte コンポーネント', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		mocks.askAi.mockReset();
		mocks.submitAiFeedback.mockReset();
	});

	it('メッセージを送信しソースと提案アクション付きでアシスタント回答を表示する', async () => {
		mocks.askAi.mockResolvedValue({
			conversationId: 'conv-a',
			messageId: 'assistant-a',
			answer: '予約運用から予約枠を作成できます。',
			sources: [
				{
					sourceKind: 'docs',
					title: '予約運用マニュアル',
					sourcePath: '/manuals/bookings',
					chunkId: 'chunk-a'
				}
			],
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
		render(AiChatWidget, {
			enabled: true,
			organizationId: 'org-a',
			storeId: 'class-a',
			currentPage: '/admin/dashboard'
		});

		await page.getByRole('button', { name: 'AIサポートを開く' }).click();
		await page.getByRole('textbox', { name: 'AIサポートへの質問' }).fill('予約枠を作るには？');
		await page.getByRole('button', { name: 'AIサポートへ送信' }).click();

		await expect.element(page.getByText('予約運用から予約枠を作成できます。')).toBeInTheDocument();
		await expect.element(page.getByText('予約運用マニュアル')).toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: /予約運用を開く/u }))
			.toHaveAttribute('href', '/admin/bookings');
		expect(mocks.askAi).toHaveBeenCalledWith({
			message: '予約枠を作るには？',
			conversationId: undefined,
			organizationId: 'org-a',
			storeId: 'class-a',
			currentPage: '/admin/dashboard'
		});
	});

	it('機能が無効な間は何も表示しない', async () => {
		render(AiChatWidget, { enabled: false });

		expect(document.querySelector('button[aria-label="AIサポートを開く"]')).toBeNull();
	});

	it('回答待ち中は入力を無効化する', async () => {
		let resolveResponse: (value: unknown) => void = () => {};
		mocks.askAi.mockReturnValue(
			new Promise((resolve) => {
				resolveResponse = resolve;
			})
		);
		render(AiChatWidget, { enabled: true });

		await page.getByRole('button', { name: 'AIサポートを開く' }).click();
		await page.getByRole('textbox', { name: 'AIサポートへの質問' }).fill('送信中の質問');
		await page.getByRole('button', { name: 'AIサポートへ送信' }).click();

		await expect.element(page.getByText('回答を作成しています。')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'AIサポートへ送信' })).toBeDisabled();

		resolveResponse({
			conversationId: 'conv-a',
			messageId: 'assistant-a',
			answer: '回答しました。',
			sources: [],
			suggestedActions: [],
			confidence: 80,
			needsHumanSupport: false,
			rateLimit: {
				userRemainingThisHour: 19,
				organizationRemainingToday: 199
			}
		});
		await expect.element(page.getByText('回答しました。')).toBeInTheDocument();
	});

	it('アクティブ組織または店舗が変わったら古い会話 ID をクリアする', async () => {
		mocks.askAi
			.mockResolvedValueOnce({
				conversationId: 'conv-a',
				messageId: 'assistant-a',
				answer: '最初の回答',
				sources: [],
				suggestedActions: [],
				confidence: 80,
				needsHumanSupport: false,
				rateLimit: {
					userRemainingThisHour: 19,
					organizationRemainingToday: 199
				}
			})
			.mockResolvedValueOnce({
				conversationId: 'conv-b',
				messageId: 'assistant-b',
				answer: '切替後の回答',
				sources: [],
				suggestedActions: [],
				confidence: 80,
				needsHumanSupport: false,
				rateLimit: {
					userRemainingThisHour: 18,
					organizationRemainingToday: 198
				}
			});
		const rendered = render(AiChatWidget, {
			enabled: true,
			organizationId: 'org-a',
			storeId: 'class-a',
			currentPage: '/admin/dashboard'
		});

		await page.getByRole('button', { name: 'AIサポートを開く' }).click();
		await page.getByRole('textbox', { name: 'AIサポートへの質問' }).fill('最初の質問');
		await page.getByRole('button', { name: 'AIサポートへ送信' }).click();
		await expect.element(page.getByText('最初の回答')).toBeInTheDocument();

		await rendered.rerender({
			enabled: true,
			organizationId: 'org-b',
			storeId: 'class-b',
			currentPage: '/admin/dashboard'
		});
		await page.getByRole('textbox', { name: 'AIサポートへの質問' }).fill('切替後の質問');
		await page.getByRole('button', { name: 'AIサポートへ送信' }).click();
		await expect.element(page.getByText('切替後の回答')).toBeInTheDocument();

		expect(mocks.askAi).toHaveBeenLastCalledWith({
			message: '切替後の質問',
			conversationId: undefined,
			organizationId: 'org-b',
			storeId: 'class-b',
			currentPage: '/admin/dashboard'
		});
	});

	it('任意コメント付きの低評価フィードバックを送信し人によるサポート案内を表示する', async () => {
		mocks.askAi.mockResolvedValue({
			conversationId: 'conv-a',
			messageId: 'assistant-a',
			answer: '断定できません。',
			sources: [],
			suggestedActions: [{ label: 'ownerに確認する', actionKind: 'contact_owner' }],
			confidence: 35,
			needsHumanSupport: true,
			rateLimit: {
				userRemainingThisHour: 19,
				organizationRemainingToday: 199
			}
		});
		mocks.submitAiFeedback.mockResolvedValue({
			feedbackId: 'feedback-a',
			messageId: 'assistant-a',
			rating: 'unhelpful'
		});
		render(AiChatWidget, { enabled: true });

		await page.getByRole('button', { name: 'AIサポートを開く' }).click();
		await page.getByRole('textbox', { name: 'AIサポートへの質問' }).fill('支払い方法を確認したい');
		await page.getByRole('button', { name: 'AIサポートへ送信' }).click();

		await expect.element(page.getByText('断定できません。')).toBeInTheDocument();
		await expect.element(page.getByText('確認が必要')).toBeInTheDocument();
		await page.getByRole('button', { name: '役に立たない' }).click();
		await page.getByRole('textbox', { name: '任意コメント' }).fill('根拠が足りません');
		await page.getByRole('button', { name: '役に立たない' }).click();

		await expect.element(page.getByText('フィードバックを送信しました。')).toBeInTheDocument();
		expect(mocks.submitAiFeedback).toHaveBeenCalledWith('assistant-a', {
			rating: 'unhelpful',
			comment: '根拠が足りません'
		});
	});

	it('フィードバック失敗状態を表示する', async () => {
		mocks.askAi.mockResolvedValue({
			conversationId: 'conv-a',
			messageId: 'assistant-a',
			answer: '回答しました。',
			sources: [],
			suggestedActions: [],
			confidence: 80,
			needsHumanSupport: false,
			rateLimit: {
				userRemainingThisHour: 19,
				organizationRemainingToday: 199
			}
		});
		mocks.submitAiFeedback.mockRejectedValue(new Error('送信失敗'));
		render(AiChatWidget, { enabled: true });

		await page.getByRole('button', { name: 'AIサポートを開く' }).click();
		await page.getByRole('textbox', { name: 'AIサポートへの質問' }).fill('フィードバック対象');
		await page.getByRole('button', { name: 'AIサポートへ送信' }).click();
		await expect.element(page.getByText('回答しました。')).toBeInTheDocument();

		await page.getByRole('button', { name: '役に立った' }).click();

		await expect.element(page.getByText('送信失敗')).toBeInTheDocument();
		expect(mocks.submitAiFeedback).toHaveBeenCalledWith('assistant-a', {
			rating: 'helpful',
			comment: undefined
		});
	});
});
