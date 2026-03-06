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

describe('/+page.svelte', () => {
	beforeEach(() => {
		mocks.url = new URL('http://localhost/');
	});

	it('should render landing sections and login links', async () => {
		render(Page);

		const heading = page.getByRole('heading', { level: 1, name: '予約運用を、ひとつの画面で。' });
		const pricingHeading = page.getByRole('heading', { level: 2, name: '料金プラン' });

		await expect.element(heading).toBeInTheDocument();
		await expect.element(pricingHeading).toBeInTheDocument();
		expect(document.body.textContent ?? '').toContain('Free');
		expect(document.body.textContent ?? '').toContain('Standard');
		expect(document.body.textContent ?? '').toContain('Business');

		const adminLinks = Array.from(document.querySelectorAll('a')).filter(
			(element) => element.textContent?.trim() === '管理者としてログイン'
		);
		const participantLinks = Array.from(document.querySelectorAll('a')).filter(
			(element) => element.textContent?.trim() === '予約者としてログイン'
		);
		expect(adminLinks.length).toBeGreaterThan(0);
		expect(participantLinks.length).toBeGreaterThan(0);
	});

	it('should carry next query into login links', async () => {
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
