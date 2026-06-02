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

	it('機能別マニュアルリンクと準備中バッジを表示する', async () => {
		render(PricingPage);

		const expectedManualHrefs = [
			'https://docs.wakureserve.com/manuals/admin/getting-started',
			'https://docs.wakureserve.com/manuals/admin/one-time-slots',
			'https://docs.wakureserve.com/manuals/admin/recurring-schedules',
			'https://docs.wakureserve.com/manuals/admin/organization-and-store',
			'https://docs.wakureserve.com/manuals/admin/admin-invitations',
			'https://docs.wakureserve.com/manuals/admin/participants-and-tickets',
			'https://docs.wakureserve.com/manuals/admin/contracts-and-premium'
		];

		for (const href of expectedManualHrefs) {
			expect(document.querySelector(`a[href="${href}"]`)).toBeTruthy();
		}

		const preparingManualLink = document.querySelector(
			'a[href="https://docs.wakureserve.com/manuals/admin/one-time-slots"]'
		);
		const publishedManualLink = document.querySelector(
			'a[href="https://docs.wakureserve.com/manuals/admin/contracts-and-premium"]'
		);

		expect(preparingManualLink?.textContent).toContain('準備中');
		expect(publishedManualLink?.textContent).not.toContain('準備中');
		await expect
			.element(page.getByRole('link', { name: /単発予約枠/ }).first())
			.toBeInTheDocument();
	});
});
