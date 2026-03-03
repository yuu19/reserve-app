import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminInvitationsPage from './+page.svelte';

describe('/admin/invitations/+page.svelte', () => {
	it('should render admin invitation heading', async () => {
		render(AdminInvitationsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '管理者招待' }))
			.toBeInTheDocument();
	});
});
