import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminSlotsPage from './+page.svelte';

describe('/admin/schedules/slots/+page.svelte', () => {
	it('should render slots list page', async () => {
		render(AdminSlotsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '単発Slot一覧' }))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '単発作成へ' })).toBeInTheDocument();
	});
});
