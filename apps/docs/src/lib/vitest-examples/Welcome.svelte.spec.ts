import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Welcome from './Welcome.svelte';

describe('Welcome.svelte コンポーネント', () => {
	it('ホストとゲスト向けの挨拶を表示する', async () => {
		render(Welcome, { host: 'SvelteKit', guest: 'Vitest' });

		await expect
			.element(page.getByRole('heading', { level: 1 }))
			.toHaveTextContent('Hello, SvelteKit!');
		await expect.element(page.getByText('Hello, Vitest!')).toBeInTheDocument();
	});
});
