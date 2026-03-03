import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminRecurringCreatePage from './+page.svelte';

describe('/admin/schedules/recurring/new/+page.svelte', () => {
	it('should render recurring create page', async () => {
		render(AdminRecurringCreatePage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '定期Schedule作成' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '定期一覧へ戻る' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '定期Schedule作成' }))
			.toBeInTheDocument();
	});
});
