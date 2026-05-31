import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TermsPage from './+page.svelte';

describe('利用規約ページ', () => {
	it('主要条項と Premium 価格、AI の操作代行対象外を表示する', async () => {
		render(TermsPage);

		await expect
			.element(page.getByRole('heading', { level: 1, name: '利用規約' }))
			.toBeInTheDocument();

		const text = document.body.textContent ?? '';
		expect(text).toContain('公開予約、予約変更、キャンセル');
		expect(text).toContain('回数券購入申請');
		expect(text).toContain('月額 1,500円、年額 15,800円');
		expect(text).toContain(
			'予約作成、予約キャンセル、請求変更、参加者登録、回数券付与などの操作を代行しません'
		);
		expect(text).toContain('日本法');
	});
});
