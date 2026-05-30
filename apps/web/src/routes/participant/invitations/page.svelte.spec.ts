import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantInvitationsPage from './+page.svelte';

describe('参加者招待ページ', () => {
	it('参加者招待の見出しを表示する', async () => {
		render(ParticipantInvitationsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '参加者招待' }))
			.toBeInTheDocument();
	});
});
