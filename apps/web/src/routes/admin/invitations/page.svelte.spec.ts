import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminInvitationsPage from './+page.svelte';

describe('管理者招待ページ', () => {
	it('管理者招待の見出しを表示する', async () => {
		render(AdminInvitationsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '管理者招待' }))
			.toBeInTheDocument();
	});
});
