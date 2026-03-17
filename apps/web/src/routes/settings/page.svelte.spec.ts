import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SettingsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/settings'),
	loadOrganizations: vi.fn(),
	createOrganization: vi.fn(),
	setActiveOrganization: vi.fn(),
	uploadOrganizationLogo: vi.fn()
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$app/state', () => ({
	page: {
		url: new URL('https://example.com/admin/settings')
	}
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

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizations: mocks.loadOrganizations,
	createOrganization: mocks.createOrganization,
	setActiveOrganization: mocks.setActiveOrganization,
	uploadOrganizationLogo: mocks.uploadOrganizationLogo
}));

describe('/settings/+page.svelte', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadOrganizations.mockReset();
		mocks.createOrganization.mockReset();
		mocks.setActiveOrganization.mockReset();
		mocks.uploadOrganizationLogo.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: true,
			activeOrganizationRole: 'owner'
		});
		mocks.resolvePortalHomePath.mockReturnValue('/admin/dashboard');
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/settings');
		mocks.loadOrganizations.mockResolvedValue({
			organizations: [
				{
					id: 'org-1',
					name: 'yusuke',
					slug: 'hoge',
					logo: 'https://cdn.example.com/yusuke.webp'
				},
				{
					id: 'org-2',
					name: 'org2',
					slug: 'org2',
					logo: null
				}
			],
			activeOrganization: {
				id: 'org-1',
				name: 'yusuke',
				slug: 'hoge',
				logo: 'https://cdn.example.com/yusuke.webp'
			}
		});
		mocks.setActiveOrganization.mockResolvedValue({ ok: true, message: '' });
	});

	it('renders organization logos in membership list with fallback', async () => {
		render(SettingsPage);

		await expect.element(page.getByRole('heading', { level: 1, name: '設定' })).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { level: 2, name: '組織設定' })).toBeInTheDocument();
		await expect.element(page.getByText('yusuke')).toBeInTheDocument();
		await expect.element(page.getByText(/^org2$/)).toBeInTheDocument();

		const logoImage = document.querySelector(
			'img[data-slot="organization-logo-image"][alt="yusuke のロゴ"]'
		) as HTMLImageElement | null;
		expect(logoImage?.getAttribute('src')).toBe('https://cdn.example.com/yusuke.webp');
		expect(document.querySelector('[data-slot="organization-logo-fallback"]')).toBeTruthy();
	});

	it('redirects non org-admin users away from settings', async () => {
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: false,
			activeOrganizationRole: null
		});
		mocks.resolvePortalHomePath.mockReturnValue('/participant/home');

		render(SettingsPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/participant/home');
		});
	});

	it('hides organization creation form for invited org admins', async () => {
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: true,
			activeOrganizationRole: 'admin'
		});

		render(SettingsPage);

		await expect.element(page.getByText('招待参加ユーザーは新しい組織を作成できません。')).toBeInTheDocument();
		expect(page.getByRole('button', { name: '組織を作成' }).query()).toBeNull();
	});
});
