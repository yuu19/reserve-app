import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantBookingsPage from './+page.svelte';

describe('/participant/bookings/+page.svelte', () => {
	it('should render participant bookings heading', async () => {
		render(ParticipantBookingsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '予約確認' }))
			.toBeInTheDocument();
	});
});
