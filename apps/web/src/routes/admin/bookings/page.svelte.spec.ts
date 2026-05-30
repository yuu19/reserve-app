import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminBookingsPage from './+page.svelte';

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

describe('管理予約ページ', () => {
	it('操作専用の管理予約ページを表示する', async () => {
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
			.element(page.getByRole('button', { name: '単発予約枠' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '定期一覧' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: 'サービス管理' }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '単発予約枠管理' }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '定期Schedule管理' }))
			.not.toBeInTheDocument();
	});
});
