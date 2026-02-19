import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BookingsPage from './+page.svelte';

describe('/bookings/+page.svelte', () => {
	it('should render bookings heading and schedule table tabs', async () => {
		render(BookingsPage);
		await expect.element(page.getByRole('heading', { level: 1, name: '予約' })).toBeInTheDocument();
		await expect
			.element(page.getByRole('tab', { name: '参加者' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '予約カレンダー' }))
			.toBeInTheDocument();
		const scheduleTab = page.getByRole('tab', { name: '日程表' });
		await expect.element(scheduleTab).toBeInTheDocument();
		await scheduleTab.click();
		await expect.element(page.getByRole('button', { name: '今後の日程' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '過去の日程' })).toBeInTheDocument();
	});
});
