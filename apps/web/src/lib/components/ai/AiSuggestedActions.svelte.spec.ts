import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AiSuggestedActions from './AiSuggestedActions.svelte';

describe('AiSuggestedActions.svelte', () => {
	it('links safe open_page actions and leaves null href actions as text', async () => {
		render(AiSuggestedActions, {
			actions: [
				{ actionKind: 'open_page', label: '予約運用を開く', href: '/admin/bookings' },
				{ actionKind: 'open_page', label: '制限されたページ', href: null },
				{ actionKind: 'contact_owner', label: 'ownerに確認する' }
			]
		});

		await expect
			.element(page.getByRole('link', { name: /予約運用を開く/u }))
			.toHaveAttribute('href', '/admin/bookings');
		expect(document.body.textContent).toContain('制限されたページ');
		expect(document.body.textContent).toContain('ownerに確認する');
		expect(
			Array.from(document.querySelectorAll('a')).map((element) => element.textContent)
		).toEqual([expect.stringContaining('予約運用を開く')]);
	});
});
