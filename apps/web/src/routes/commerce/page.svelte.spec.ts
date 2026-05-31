import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CommercePage from './+page.svelte';

describe('特定商取引法に基づく表記ページ', () => {
	it('TODO の事業者情報、販売価格、支払方法、対象外の店舗取引を表示する', async () => {
		render(CommercePage);

		await expect
			.element(page.getByRole('heading', { level: 1, name: '特定商取引法に基づく表記' }))
			.toBeInTheDocument();

		const text = document.body.textContent ?? '';
		expect(text).toContain('TODO: 正式な事業者名に差し替え');
		expect(text).toContain('TODO: 正式な責任者名に差し替え');
		expect(text).toContain('TODO: 正式な所在地に差し替え');
		expect(text).toContain('TODO: 確実に連絡できる電話番号に差し替え');
		expect(text).toContain('TODO: 正式な問い合わせメールアドレスに差し替え');
		expect(text).toContain('Premium 月額 1,500円、年額 15,800円');
		expect(text).toContain('Stripe Checkout または Stripe Customer Portal');
		expect(text).toContain(
			'店舗が提供する予約サービス、レッスン、イベント、回数券、現地決済、銀行振込は各店舗の取引'
		);
	});
});
