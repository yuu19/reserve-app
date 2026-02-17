import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('/+page.svelte', () => {
	it('should render auth lp', async () => {
		render(Page);

		const heading = page.getByRole('heading', { level: 1, name: '予約管理ダッシュボード' });
		const signInTab = page.getByRole('tab', { name: 'サインイン' });
		await expect.element(heading).toBeInTheDocument();
		await expect.element(signInTab).toBeInTheDocument();
	});
});
