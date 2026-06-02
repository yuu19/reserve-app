import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PricingPage from './+page.svelte';

describe('料金ページ', () => {
	it('プラン、価格、比較表、注意事項、法務リンクを表示する', async () => {
		render(PricingPage);

		await expect.element(page.getByRole('heading', { level: 1, name: '料金' })).toBeInTheDocument();

		const text = document.body.textContent ?? '';
		expect(text).toContain('Free');
		expect(text).toContain('Premium');
		expect(text).toContain('月額 1,500円');
		expect(text).toContain('年額 15,800円');
		expect(text).toContain('7日間トライアル');
		expect(text).toContain('プラン比較');
		expect(text).toContain('複数店舗・複数拠点');
		expect(text).toContain('スタッフ招待と権限管理');
		expect(text).toContain('注意事項');

		await expect.element(page.getByRole('table', { name: '料金比較' })).toBeInTheDocument();

		const commerceLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === '特定商取引法に基づく表記'
		);
		const premiumActionLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === '契約画面で確認'
		);
		expect(commerceLink?.getAttribute('href')).toBe('/commerce');
		expect(premiumActionLink?.getAttribute('href')).toBe('/admin/login?next=%2Fadmin%2Fcontracts');
	});
});
