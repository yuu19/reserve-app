import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminSlotCreatePage from './+page.svelte';

describe('/admin/schedules/slots/new/+page.svelte', () => {
	it('should render slots create page', async () => {
		render(AdminSlotCreatePage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '単発Slot作成' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '単発一覧へ戻る' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '単発Slot作成' }))
			.toBeInTheDocument();
	});
});
