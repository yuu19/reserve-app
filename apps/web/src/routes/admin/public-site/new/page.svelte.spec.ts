import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PublicSiteCreatePage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/public-site/new'),
	loadPublicSiteSettings: vi.fn(),
	updatePublicSiteSettings: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	url: new URL('https://example.com/hoge/room-one/admin/public-site/new')
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
	loadPublicSiteSettings: mocks.loadPublicSiteSettings,
	updatePublicSiteSettings: mocks.updatePublicSiteSettings
}));

describe('公開サイト新規作成ページ', () => {
	beforeEach(() => {
		pageState.url = new URL('https://example.com/hoge/room-one/admin/public-site/new');
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadPublicSiteSettings.mockReset();
		mocks.updatePublicSiteSettings.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: true,
			activeOrganizationRole: 'admin'
		});
		mocks.resolvePortalHomePath.mockReturnValue('/admin/dashboard');
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/public-site/new');
		mocks.loadPublicSiteSettings.mockResolvedValue({
			organizationId: 'org-1',
			organizationSlug: 'hoge',
			organizationName: 'yusuke',
			storeId: 'room-1',
			storeSlug: 'room-one',
			storeName: 'Room One',
			siteName: 'Room One',
			description: '',
			address: '',
			phone: '',
			businessHours: '',
			imageUrl: ''
		});
		mocks.updatePublicSiteSettings.mockResolvedValue({
			ok: true,
			message: '予約サイトトップページを更新しました。',
			publicSite: {
				siteName: 'Tokyo Studio',
				description: 'Public description',
				address: 'Tokyo',
				phone: '',
				businessHours: '',
				imageUrl: ''
			}
		});
	});

	it('スコープ付き公開サイト設定を作成し管理ページへ戻る', async () => {
		render(PublicSiteCreatePage);

		await expect
			.element(page.getByRole('heading', { level: 1, name: '予約サイト作成' }))
			.toBeInTheDocument();
		await page.getByLabelText('サイト名').fill('Tokyo Studio');
		await page.getByLabelText('説明').fill('Public description');
		await page.getByLabelText('住所').fill('Tokyo');
		await page.getByRole('button', { name: '予約サイトを保存' }).click();

		await vi.waitFor(() => {
			expect(mocks.updatePublicSiteSettings).toHaveBeenCalledWith(
				{
					orgSlug: 'hoge',
					storeSlug: 'room-one'
				},
				expect.objectContaining({
					siteName: 'Tokyo Studio',
					description: 'Public description',
					address: 'Tokyo'
				})
			);
			expect(mocks.goto).toHaveBeenCalledWith('/hoge/room-one/admin/public-site');
		});
	});

	it('非スコープ管理ルートでは店舗コンテキストを要求する', async () => {
		pageState.url = new URL('https://example.com/admin/public-site/new');

		render(PublicSiteCreatePage);

		await expect
			.element(page.getByRole('heading', { level: 2, name: '店舗を選択してください' }))
			.toBeInTheDocument();
		expect(mocks.updatePublicSiteSettings).not.toHaveBeenCalled();
	});
});
