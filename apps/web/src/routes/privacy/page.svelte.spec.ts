import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PrivacyPage from './+page.svelte';

describe('プライバシーポリシーページ', () => {
	it('取得情報、外部サービス、決済情報非保持、AI 保持期間を表示する', async () => {
		render(PrivacyPage);

		await expect
			.element(page.getByRole('heading', { level: 1, name: 'プライバシーポリシー' }))
			.toBeInTheDocument();

		const text = document.body.textContent ?? '';
		expect(text).toContain('アカウント、セッション');
		expect(text).toContain('公開予約、予約者情報');
		expect(text).toContain('Cloudflare');
		expect(text).toContain('Stripe');
		expect(text).toContain('Resend');
		expect(text).toContain('Sentry');
		expect(text).toContain('Google OIDC');
		expect(text).toContain(
			'カード番号、支払い方法の詳細、税務詳細、Stripe raw payload を保存しません'
		);
		expect(text).toContain('AI 会話内容は 180 日');
		expect(text).toContain('AI の集計フィードバックは 1 年');
	});
});
