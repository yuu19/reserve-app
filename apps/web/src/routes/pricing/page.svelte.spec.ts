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

		await expect.element(page.getByRole('table', { name: 'プラン比較' })).toBeInTheDocument();

		const commerceLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === '特定商取引法に基づく表記'
		);
		const premiumActionLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === '契約画面で確認'
		);
		expect(commerceLink?.getAttribute('href')).toBe('/commerce');
		expect(premiumActionLink?.getAttribute('href')).toBe('/admin/login?next=%2Fadmin%2Fcontracts');
	});

	it('プランカードにはマニュアルリンクを表示しない', async () => {
		render(PricingPage);

		const plansSection = document.querySelector('section[aria-labelledby="plans-heading"]');

		expect(plansSection?.textContent).toContain(
			'公開予約受付を始める基本機能と、運営拡張に必要な Premium 機能を比較できます。'
		);
		expect(plansSection?.querySelector('a[href^="https://docs.wakureserve.com/manuals/"]')).toBeNull();
		expect(plansSection?.textContent).not.toContain('準備中');
	});

	it('カテゴリ付きの機能比較表を表示する', async () => {
		render(PricingPage);

		const comparisonTable = document.querySelector('table[aria-labelledby="comparison-heading"]');
		expect(comparisonTable).toBeTruthy();

		for (const category of [
			'予約受付・管理',
			'店舗・スタッフ運用',
			'参加者・継続運用',
			'契約・分析'
		]) {
			expect(comparisonTable?.textContent).toContain(category);
		}

		const expectedFeatureLinks = [
			{
				label: '予約受付',
				href: 'https://docs.wakureserve.com/manuals/admin/one-time-slots'
			},
			{
				label: '店舗管理',
				href: 'https://docs.wakureserve.com/manuals/admin/organization-and-store'
			},
			{
				label: 'スタッフ権限',
				href: 'https://docs.wakureserve.com/manuals/admin/admin-invitations'
			},
			{
				label: '参加者管理',
				href: 'https://docs.wakureserve.com/manuals/admin/participants-and-tickets'
			},
			{
				label: '継続運用',
				href: 'https://docs.wakureserve.com/manuals/admin/participants-and-tickets'
			},
			{
				label: '契約管理',
				href: 'https://docs.wakureserve.com/manuals/admin/contracts-and-premium'
			}
		];

		for (const expected of expectedFeatureLinks) {
			const link = Array.from(comparisonTable?.querySelectorAll('a') ?? []).find((element) =>
				element.textContent?.includes(expected.label)
			);
			expect(link?.getAttribute('href')).toBe(expected.href);
		}

		const bookingReceptionRow = Array.from(comparisonTable?.querySelectorAll('tbody tr') ?? []).find(
			(element) =>
				element.textContent?.includes('予約受付') &&
				element.textContent?.includes('単発予約枠の公開と受付')
		);
		expect(bookingReceptionRow).toBeTruthy();
		expect(
			bookingReceptionRow
				?.querySelector('a[href="https://docs.wakureserve.com/manuals/admin/one-time-slots"]')
				?.textContent
		).toContain('予約受付');
		expect(
			bookingReceptionRow
				?.querySelector('a[href="https://docs.wakureserve.com/manuals/admin/recurring-schedules"]')
				?.textContent
		).toContain('定期スケジュール');
	});

	it('機能別マニュアルリンクと準備中バッジを表示する', async () => {
		render(PricingPage);

		const expectedManualHrefs = [
			'https://docs.wakureserve.com/manuals/admin/one-time-slots',
			'https://docs.wakureserve.com/manuals/admin/recurring-schedules',
			'https://docs.wakureserve.com/manuals/admin/organization-and-store',
			'https://docs.wakureserve.com/manuals/admin/admin-invitations',
			'https://docs.wakureserve.com/manuals/admin/participants-and-tickets',
			'https://docs.wakureserve.com/manuals/admin/contracts-and-premium'
		];

		const comparisonTable = document.querySelector('table[aria-labelledby="comparison-heading"]');
		for (const href of expectedManualHrefs) {
			expect(comparisonTable?.querySelector(`a[href="${href}"]`)).toBeTruthy();
		}

		const preparingManualLink = comparisonTable?.querySelector(
			'a[href="https://docs.wakureserve.com/manuals/admin/one-time-slots"]'
		);
		const publishedManualLink = comparisonTable?.querySelector(
			'a[href="https://docs.wakureserve.com/manuals/admin/contracts-and-premium"]'
		);

		expect(preparingManualLink?.textContent).toContain('準備中');
		expect(publishedManualLink?.textContent).not.toContain('準備中');
		await expect
			.element(page.getByRole('link', { name: /予約受付/ }).first())
			.toBeInTheDocument();
	});
});
