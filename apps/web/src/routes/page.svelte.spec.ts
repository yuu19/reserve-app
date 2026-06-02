import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

const mocks = vi.hoisted(() => ({
	url: new URL('http://localhost/')
}));

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return mocks.url;
		}
	}
}));

describe('トップページ', () => {
	beforeEach(() => {
		mocks.url = new URL('http://localhost/');
	});

	it('ランディングセクションとログインリンクを表示する', async () => {
		render(Page);

		const heading = page.getByRole('heading', {
			level: 1,
			name: '小規模スクール・教室の予約運用を、ひとつの管理画面に。'
		});
		const pricingHeading = page.getByRole('heading', { level: 2, name: '料金' });

		await expect.element(heading).toBeInTheDocument();
		await expect.element(pricingHeading).toBeInTheDocument();
		await expect
			.element(page.getByLabelText('WakuReserveの運用画面プレビュー'))
			.toBeInTheDocument();
		expect(document.body.textContent ?? '').toContain('Free');
		expect(document.body.textContent ?? '').toContain('Premium');
		expect(document.body.textContent ?? '').toContain('1,500円');
		expect(document.body.textContent ?? '').toContain('15,800円');
		expect(document.body.textContent ?? '').not.toContain('9,800');
		expect(document.body.textContent ?? '').not.toContain('料金プラン');
		expect(document.body.textContent ?? '').not.toContain('プラン比較');
		expect(document.body.textContent ?? '').toContain('無料で始める');
		expect(document.body.textContent ?? '').toContain('回数券管理、複数店舗、スタッフ招待');
		expect(document.body.textContent ?? '').not.toContain('サービス紹介');
		expect(document.body.textContent ?? '').not.toContain('開発者情報');
		const pricingSection = document.querySelector(
			'section[aria-labelledby="pricing-summary-heading"]'
		);
		expect(pricingSection).not.toBeNull();
		expect(pricingSection?.querySelector('[data-slot="card"]')).toBeNull();
		expect(pricingSection?.querySelector('table')).toBeNull();

		const adminLinks = Array.from(document.querySelectorAll('a')).filter((element) =>
			element.textContent?.includes('管理者としてログイン')
		);
		const participantLinks = Array.from(document.querySelectorAll('a')).filter((element) =>
			element.textContent?.includes('予約者としてログイン')
		);
		const freeStartLinks = Array.from(document.querySelectorAll('a')).filter(
			(element) => element.textContent?.trim() === '無料で始める'
		);
		const featureLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === '機能'
		);
		const loginSectionLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === 'ログイン'
		);
		const pricingLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === '料金を見る'
		);
		const pricingDetailLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === '料金ページへ'
		);
		const footerPricingLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === '料金'
		);
		const termsLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === '利用規約'
		);
		const privacyLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === 'プライバシーポリシー'
		);
		const commerceLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === '特定商取引法に基づく表記'
		);
		const githubLink = document.querySelector('a[href="https://github.com/yuu19/reserve-app"]');
		const xLink = document.querySelector('a[href="https://x.com/wakureserve"]');
		const serviceIntroLink = document.querySelector('a[href="https://wakureserve.com"]');
		const developerLink = document.querySelector('a[href="https://wakureserve.com/developer"]');
		expect(adminLinks.length).toBeGreaterThan(0);
		expect(participantLinks.length).toBeGreaterThan(0);
		expect(freeStartLinks.length).toBeGreaterThan(0);
		expect(freeStartLinks[0]?.getAttribute('href')).toBe('/admin/login?next=%2Fadmin%2Fonboarding');
		expect(featureLink?.getAttribute('href')).toBe('#features');
		expect(loginSectionLink?.getAttribute('href')).toBe('#portal-entry');
		expect(pricingLink?.getAttribute('href')).toBe('/pricing');
		expect(pricingDetailLink?.getAttribute('href')).toBe('/pricing');
		expect(footerPricingLink?.getAttribute('href')).toBe('/pricing');
		expect(termsLink?.getAttribute('href')).toBe('/terms');
		expect(termsLink?.getAttribute('target')).toBeNull();
		expect(privacyLink?.getAttribute('href')).toBe('/privacy');
		expect(privacyLink?.getAttribute('target')).toBeNull();
		expect(commerceLink?.getAttribute('href')).toBe('/commerce');
		expect(commerceLink?.getAttribute('target')).toBeNull();
		expect(githubLink).toBeNull();
		expect(xLink).toBeNull();
		expect(serviceIntroLink).toBeNull();
		expect(developerLink).toBeNull();
	});

	it('ログインリンクへ next クエリを引き継ぐ', async () => {
		mocks.url = new URL('http://localhost/?next=/admin/services/new');
		render(Page);

		const adminAnchor = Array.from(document.querySelectorAll('a')).find((element) =>
			element.textContent?.includes('管理者としてログイン')
		);
		const participantAnchor = Array.from(document.querySelectorAll('a')).find((element) =>
			element.textContent?.includes('予約者としてログイン')
		);

		expect(adminAnchor?.getAttribute('href')).toBe('/admin/login?next=%2Fadmin%2Fservices%2Fnew');
		expect(participantAnchor?.getAttribute('href')).toBe(
			'/participant/login?next=%2Fadmin%2Fservices%2Fnew'
		);
	});
});
