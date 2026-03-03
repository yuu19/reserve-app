import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BookingsPage from './+page.svelte';

describe('/bookings/+page.svelte', () => {
	it('should render legacy redirect guidance', async () => {
		render(BookingsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '予約ポータルへ移動中' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText('権限に応じた予約画面へリダイレクトします。'))
			.toBeInTheDocument();
	});
});
