import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ContractsPage from './+page.svelte';

describe('/contracts/+page.svelte', () => {
	it('should render contracts heading and plan section', async () => {
		render(ContractsPage);
		await expect.element(page.getByRole('heading', { level: 1, name: '契約' })).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { level: 2, name: '現在プラン' })).toBeInTheDocument();
	});
});
