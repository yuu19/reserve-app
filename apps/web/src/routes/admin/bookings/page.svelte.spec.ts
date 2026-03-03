import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminBookingsPage from './+page.svelte';

describe('/admin/bookings/+page.svelte', () => {
	it('should render operations-only admin bookings page', async () => {
		render(AdminBookingsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '予約管理' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '予約運用' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'サービス一覧' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '単発一覧' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '定期一覧' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: 'サービス管理' }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '単発Slot管理' }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '定期Schedule管理' }))
			.not.toBeInTheDocument();
	});
});
