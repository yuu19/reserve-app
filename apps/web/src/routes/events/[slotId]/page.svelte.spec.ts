import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EventDetailPage from './+page.svelte';

describe('/events/[slotId]/+page.svelte', () => {
	it('should render event detail heading and reserve button', async () => {
		render(EventDetailPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: 'イベント詳細' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '参加登録して予約する' }))
			.toBeInTheDocument();
	});
});
