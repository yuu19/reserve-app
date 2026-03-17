import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantBookingsPage from './+page.svelte';

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

describe('/participant/bookings/+page.svelte', () => {
	it('should render participant bookings heading', async () => {
		render(ParticipantBookingsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '予約確認' }))
			.toBeInTheDocument();
	});
});
