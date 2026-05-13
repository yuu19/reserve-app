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
	submitAiFeedback: mocks.submitAiFeedback
}));

describe('AiChatWidget.svelte', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		mocks.askAi.mockReset();
		mocks.submitAiFeedback.mockReset();
	});

	it('sends a message and renders the assistant answer with sources and suggested actions', async () => {
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
			needsHumanSupport: false
		});
		render(AiChatWidget, {
			active: true,
			organizationId: 'org-a',
			classroomId: 'class-a',
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
			classroomId: 'class-a',
			currentPage: '/admin/dashboard'
		});
	});

	it('clears the stale conversation id when the active organization or classroom changes', async () => {
		mocks.askAi
			.mockResolvedValueOnce({
				conversationId: 'conv-a',
				messageId: 'assistant-a',
				answer: '最初の回答',
				sources: [],
				suggestedActions: [],
				confidence: 80,
				needsHumanSupport: false
			})
			.mockResolvedValueOnce({
				conversationId: 'conv-b',
				messageId: 'assistant-b',
				answer: '切替後の回答',
				sources: [],
				suggestedActions: [],
				confidence: 80,
				needsHumanSupport: false
			});
		const rendered = render(AiChatWidget, {
			active: true,
			organizationId: 'org-a',
			classroomId: 'class-a',
			currentPage: '/admin/dashboard'
		});

		await page.getByRole('button', { name: 'AIサポートを開く' }).click();
		await page.getByRole('textbox', { name: 'AIサポートへの質問' }).fill('最初の質問');
		await page.getByRole('button', { name: 'AIサポートへ送信' }).click();
		await expect.element(page.getByText('最初の回答')).toBeInTheDocument();

		await rendered.rerender({
			active: true,
			organizationId: 'org-b',
			classroomId: 'class-b',
			currentPage: '/admin/dashboard'
		});
		await page.getByRole('textbox', { name: 'AIサポートへの質問' }).fill('切替後の質問');
		await page.getByRole('button', { name: 'AIサポートへ送信' }).click();
		await expect.element(page.getByText('切替後の回答')).toBeInTheDocument();

		expect(mocks.askAi).toHaveBeenLastCalledWith({
			message: '切替後の質問',
			conversationId: undefined,
			organizationId: 'org-b',
			classroomId: 'class-b',
			currentPage: '/admin/dashboard'
		});
	});

	it('submits unhelpful feedback with an optional comment and shows human-support guidance', async () => {
		mocks.askAi.mockResolvedValue({
			conversationId: 'conv-a',
			messageId: 'assistant-a',
			answer: '断定できません。',
			sources: [],
			suggestedActions: [{ label: 'ownerに確認する', actionKind: 'contact_owner' }],
			confidence: 35,
			needsHumanSupport: true
		});
		mocks.submitAiFeedback.mockResolvedValue({
			feedbackId: 'feedback-a',
			messageId: 'assistant-a',
			rating: 'unhelpful'
		});
		render(AiChatWidget, { active: true });

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
});
