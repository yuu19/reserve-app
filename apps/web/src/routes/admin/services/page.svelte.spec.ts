import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminServicesPage from './+page.svelte';

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

describe('/admin/services/+page.svelte', () => {
	it('should render services list page', async () => {
		render(AdminServicesPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: 'サービス一覧' }))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'サービス作成へ' })).toBeInTheDocument();
		await expect.element(page.getByText('サービス更新')).not.toBeInTheDocument();
	});
});
