import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EventsPage from './+page.svelte';

describe('/events/+page.svelte', () => {
	it('should render public events heading and description', async () => {
		render(EventsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '公開イベント' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText('イベント閲覧はログイン不要です。参加登録・予約操作はログイン後に行えます。'))
			.toBeInTheDocument();
	});
});
