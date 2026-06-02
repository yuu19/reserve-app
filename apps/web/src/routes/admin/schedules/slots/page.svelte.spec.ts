import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminSlotsPage from './+page.svelte';

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

describe('単発枠一覧ページ', () => {
	it('単発枠一覧ページを表示する', async () => {
		render(AdminSlotsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '単発予約枠一覧' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '単発予約枠作成へ' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText('単発予約枠の確認、公開予約表示の変更、停止を行います。'))
			.toBeInTheDocument();
	});
});
