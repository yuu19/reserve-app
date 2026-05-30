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

		const heading = page.getByRole('heading', { level: 1, name: 'WakuReserve' });
		const pricingHeading = page.getByRole('heading', { level: 2, name: '料金プラン' });

		await expect.element(heading).toBeInTheDocument();
		await expect.element(pricingHeading).toBeInTheDocument();
		await expect
			.element(page.getByLabelText('WakuReserveの運用画面プレビュー'))
			.toBeInTheDocument();
		expect(document.body.textContent ?? '').toContain('Free');
		expect(document.body.textContent ?? '').toContain('Premium');
		expect(document.body.textContent ?? '').toContain('開発者情報');

		const adminLinks = Array.from(document.querySelectorAll('a')).filter(
			(element) => element.textContent?.trim() === '管理者としてログイン'
		);
		const participantLinks = Array.from(document.querySelectorAll('a')).filter(
			(element) => element.textContent?.trim() === '予約者としてログイン'
		);
		const footerLoginLink = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === 'ログイン入口へ'
		);
		expect(adminLinks.length).toBeGreaterThan(0);
		expect(participantLinks.length).toBeGreaterThan(0);
		expect(footerLoginLink?.getAttribute('href')).toBe('#portal-entry');
	});

	it('ログインリンクへ next クエリを引き継ぐ', async () => {
		mocks.url = new URL('http://localhost/?next=/admin/services/new');
		render(Page);

		const adminAnchor = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === '管理者としてログイン'
		);
		const participantAnchor = Array.from(document.querySelectorAll('a')).find(
			(element) => element.textContent?.trim() === '予約者としてログイン'
		);

		expect(adminAnchor?.getAttribute('href')).toBe('/admin/login?next=%2Fadmin%2Fservices%2Fnew');
		expect(participantAnchor?.getAttribute('href')).toBe(
			'/participant/login?next=%2Fadmin%2Fservices%2Fnew'
		);
	});
});
