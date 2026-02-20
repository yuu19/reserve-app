import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantsPage from './+page.svelte';

describe('/participants/+page.svelte', () => {
	it('should render participants heading', async () => {
		render(ParticipantsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '参加者' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '回数券管理' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3, name: '回数券種別作成' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3, name: '回数券付与' }))
			.toBeInTheDocument();
	});
});
