import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantAdminInvitationsPage from './+page.svelte';

describe('/participant/admin-invitations/+page.svelte', () => {
	it('should render participant admin invitation heading', async () => {
		render(ParticipantAdminInvitationsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '受信した管理者招待' }))
			.toBeInTheDocument();
	});
});
