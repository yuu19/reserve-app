import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DashboardPage from './+page.svelte';

describe('/dashboard/+page.svelte', () => {
	it('should render dashboard heading and settings link', async () => {
		render(DashboardPage);
		await expect.element(page.getByRole('heading', { level: 1, name: 'ダッシュボード' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '設定へ移動' })).toBeInTheDocument();
	});
});
