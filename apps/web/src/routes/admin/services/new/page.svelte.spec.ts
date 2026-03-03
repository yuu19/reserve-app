import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminServiceCreatePage from './+page.svelte';

describe('/admin/services/new/+page.svelte', () => {
	it('should render services create page', async () => {
		render(AdminServiceCreatePage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: 'サービス作成' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'サービス一覧へ戻る' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: 'サービス作成' }))
			.toBeInTheDocument();
		await expect.element(page.getByLabelText('サービス説明')).toBeInTheDocument();
		await expect.element(page.getByLabelText('キャンセル期限（分）')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '単発' })).toBeInTheDocument();
		await expect
			.element(page.getByLabelText('サービス名'))
			.toHaveAttribute('maxlength', '120');
		await expect
			.element(page.getByLabelText('サービス説明'))
			.toHaveAttribute('maxlength', '500');
	});
});
