import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminServicesPage from './+page.svelte';

describe('/admin/services/+page.svelte', () => {
	it('should render services list page', async () => {
		render(AdminServicesPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: 'サービス一覧' }))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'サービス作成へ' })).toBeInTheDocument();
	});
});
