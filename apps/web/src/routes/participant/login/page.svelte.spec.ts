import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantLoginPage from './+page.svelte';

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

describe('/participant/login/+page.svelte', () => {
	it('should render participant login heading', async () => {
		render(ParticipantLoginPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '予約者ページログイン' }))
			.toBeInTheDocument();
	});
});
