import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BookingsPage from './+page.svelte';

describe('/bookings/+page.svelte', () => {
	it('should render bookings heading', async () => {
		render(BookingsPage);
		await expect.element(page.getByRole('heading', { level: 1, name: '予約' })).toBeInTheDocument();
	});
});
