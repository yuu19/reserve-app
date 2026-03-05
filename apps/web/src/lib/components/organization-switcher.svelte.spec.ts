import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import OrganizationSwitcher from './organization-switcher.svelte';

describe('organization-switcher.svelte', () => {
	const organizations = [
		{ id: 'org-a', name: 'Alpha Org', slug: 'alpha', logo: null },
		{ id: 'org-b', name: 'Beta Org', slug: 'beta', logo: 'https://cdn.example.com/beta.webp' },
		{ id: 'org-c', name: 'Gamma Team', slug: 'gamma', logo: null }
	];

	it('shows active organization on trigger', async () => {
		render(OrganizationSwitcher, {
			organizations,
			activeOrganizationId: 'org-b',
			activeOrganizationName: 'Beta Org',
			loading: false,
			busy: false,
			onSelect: vi.fn()
		});

		await expect.element(page.getByText('Beta Org')).toBeInTheDocument();
		const triggerImage = document.querySelector(
			'button[aria-label="利用中の組織を切り替え"] img[data-slot="organization-logo-image"]'
		) as HTMLImageElement | null;
		expect(triggerImage?.getAttribute('src')).toBe('https://cdn.example.com/beta.webp');
	});

	it('filters organization list by search keyword', async () => {
		render(OrganizationSwitcher, {
			organizations,
			activeOrganizationId: 'org-b',
			activeOrganizationName: 'Beta Org',
			loading: false,
			busy: false,
			onSelect: vi.fn()
		});

		await page.getByRole('button', { name: '利用中の組織を切り替え' }).click();
		await page.getByRole('textbox', { name: '組織を検索' }).fill('Gamma');

		await expect.element(page.getByText('Gamma Team')).toBeInTheDocument();
		await expect.element(page.getByText('Alpha Org')).not.toBeInTheDocument();
	});

	it('calls onSelect with selected organization id', async () => {
		const onSelect = vi.fn();
		render(OrganizationSwitcher, {
			organizations,
			activeOrganizationId: null,
			activeOrganizationName: '組織未選択',
			loading: false,
			busy: false,
			onSelect
		});

		await page.getByRole('button', { name: '利用中の組織を切り替え' }).click();
		await page.getByRole('button', { name: 'Beta Orgを利用中の組織に設定' }).click();

		expect(onSelect).toHaveBeenCalledWith('org-b');
	});

	it('shows empty message when no organizations match search', async () => {
		render(OrganizationSwitcher, {
			organizations,
			activeOrganizationId: null,
			activeOrganizationName: '組織未選択',
			loading: false,
			busy: false,
			onSelect: vi.fn()
		});

		await page.getByRole('button', { name: '利用中の組織を切り替え' }).click();
		await page.getByRole('textbox', { name: '組織を検索' }).fill('not-found');

		await expect.element(page.getByText('一致する組織がありません。')).toBeInTheDocument();
	});

	it('shows logo image and fallback in dropdown list', async () => {
		render(OrganizationSwitcher, {
			organizations,
			activeOrganizationId: 'org-b',
			activeOrganizationName: 'Beta Org',
			loading: false,
			busy: false,
			onSelect: vi.fn()
		});

		await page.getByRole('button', { name: '利用中の組織を切り替え' }).click();

		const betaRowImage = document.querySelector(
			'button[aria-label="Beta Orgを利用中の組織に設定"] img[data-slot="organization-logo-image"]'
		) as HTMLImageElement | null;
		expect(betaRowImage?.getAttribute('src')).toBe('https://cdn.example.com/beta.webp');

		const alphaRowFallback = document.querySelector(
			'button[aria-label="Alpha Orgを利用中の組織に設定"] [data-slot="organization-logo-fallback"]'
		);
		expect(alphaRowFallback).toBeTruthy();
	});
});
