import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SettingsPage from './+page.svelte';

describe('/settings/+page.svelte', () => {
	it('should render settings heading and organization section', async () => {
		render(SettingsPage);
		await expect.element(page.getByRole('heading', { level: 1, name: '設定' })).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { level: 2, name: '組織設定' })).toBeInTheDocument();
	});
});
