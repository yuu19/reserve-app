import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantInvitationsPage from './+page.svelte';

describe('/participant/invitations/+page.svelte', () => {
	it('should render participant invitation heading', async () => {
		render(ParticipantInvitationsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '参加者招待' }))
			.toBeInTheDocument();
	});
});
