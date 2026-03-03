import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import OrganizationSwitcher from './organization-switcher.svelte';

describe('organization-switcher.svelte', () => {
	const organizations = [
		{ id: 'org-a', name: 'Alpha Org', slug: 'alpha' },
		{ id: 'org-b', name: 'Beta Org', slug: 'beta' },
		{ id: 'org-c', name: 'Gamma Team', slug: 'gamma' }
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
});
