import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminRecurringPage from './+page.svelte';

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

describe('/admin/schedules/recurring/+page.svelte', () => {
	it('should render recurring list page', async () => {
		render(AdminRecurringPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '定期Schedule一覧' }))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '定期作成へ' })).toBeInTheDocument();
		await expect.element(page.getByText('定期Schedule更新')).not.toBeInTheDocument();
	});
});
