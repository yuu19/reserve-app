import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminParticipantsPage from './+page.svelte';

describe('/admin/participants/+page.svelte', () => {
	it('should render admin participants heading', async () => {
		render(AdminParticipantsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '参加者管理' }))
			.toBeInTheDocument();
	});
});
