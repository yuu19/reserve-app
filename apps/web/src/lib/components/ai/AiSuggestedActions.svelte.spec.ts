import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AiSuggestedActions from './AiSuggestedActions.svelte';

const pageState = vi.hoisted(() => ({
	url: new URL('https://example.com/admin/dashboard')
}));

vi.mock('$app/state', () => ({
	page: pageState
}));

describe('AiSuggestedActions.svelte コンポーネント', () => {
	beforeEach(() => {
		pageState.url = new URL('https://example.com/admin/dashboard');
	});

	it('安全な open_page アクションをリンク化し href が null のアクションはテキストにする', async () => {
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

	it('open_page アクションでスコープ付きコンテキストを保持する', async () => {
		pageState.url = new URL('https://example.com/org-one/room-a/admin/dashboard');

		render(AiSuggestedActions, {
			actions: [{ actionKind: 'open_page', label: '予約運用を開く', href: '/admin/bookings' }]
		});

		await expect
			.element(page.getByRole('link', { name: /予約運用を開く/u }))
			.toHaveAttribute('href', '/org-one/room-a/admin/bookings');
	});
});
