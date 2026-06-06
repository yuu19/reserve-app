import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PublicSitePage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/public-site'),
	loadPublicSiteSettings: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	url: new URL('https://example.com/hoge/room-one/admin/public-site')
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$app/state', () => ({
	page: pageState
}));

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession,
	loadPortalAccess: mocks.loadPortalAccess,
	resolvePortalHomePath: mocks.resolvePortalHomePath,
	redirectToLoginWithNext: mocks.redirectToLoginWithNext,
	getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
}));

vi.mock('$lib/features/public-site.svelte', () => ({
	loadPublicSiteSettings: mocks.loadPublicSiteSettings
}));

describe('公開サイト管理ページ', () => {
	beforeEach(() => {
		pageState.url = new URL('https://example.com/hoge/room-one/admin/public-site');
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadPublicSiteSettings.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: true,
			activeOrganizationRole: 'admin'
		});
		mocks.resolvePortalHomePath.mockReturnValue('/admin/dashboard');
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/public-site');
		mocks.loadPublicSiteSettings.mockResolvedValue({
			organizationId: 'org-1',
			organizationSlug: 'hoge',
			organizationName: 'yusuke',
			storeId: 'room-1',
			storeSlug: 'room-one',
			storeName: 'Room One',
			siteName: 'Tokyo Studio',
			description: 'Public description',
			address: 'Tokyo',
			phone: '03-0000-0000',
			businessHours: '10:00-18:00',
			imageUrl: ''
		});
	});

	it('スコープ付き公開サイト管理アクションを表示する', async () => {
		render(PublicSitePage);

		await expect
			.element(page.getByRole('heading', { level: 1, name: '予約サイト管理' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('Tokyo Studio')).toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: '予約サイトを作成・編集' }))
			.toHaveAttribute('href', '/hoge/room-one/admin/public-site/new');
		await expect
			.element(page.getByRole('link', { name: '公開ページを開く' }))
			.toHaveAttribute('href', '/hoge/room-one');
		await expect
			.element(page.getByRole('link', { name: '予約ページ一覧を開く' }))
			.toHaveAttribute('href', '/hoge/room-one/events');
		await expect
			.element(page.getByRole('link', { name: '予約フォーム設定へ移動' }))
			.toHaveAttribute('href', '/hoge/room-one/admin/forms');
	});

	it('非スコープ管理ルートでは店舗コンテキストを要求する', async () => {
		pageState.url = new URL('https://example.com/admin/public-site');

		render(PublicSitePage);

		await expect
			.element(page.getByRole('heading', { level: 2, name: '店舗を選択してください' }))
			.toBeInTheDocument();
		expect(mocks.loadPublicSiteSettings).not.toHaveBeenCalled();
	});
});
