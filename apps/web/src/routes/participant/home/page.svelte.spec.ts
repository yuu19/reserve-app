import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantHomePage from './+page.svelte';

describe('/participant/home/+page.svelte', () => {
	it('should render participant home heading', async () => {
		render(ParticipantHomePage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '参加者ホーム' }))
			.toBeInTheDocument();
	});
});
