import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ContractsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/contracts'),
	loadOrganizations: vi.fn()
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$app/state', () => ({
	page: {
		url: new URL('https://example.com/admin/contracts')
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
	loadOrganizations: mocks.loadOrganizations
}));

describe('/contracts/+page.svelte', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadOrganizations.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: true
		});
		mocks.resolvePortalHomePath.mockReturnValue('/admin/dashboard');
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/contracts');
		mocks.loadOrganizations.mockResolvedValue({
			activeOrganization: {
				id: 'org-1',
				name: 'Org One',
				slug: 'org-one'
			}
		});
	});

	it('should render contracts heading and plan section', async () => {
		render(ContractsPage);
		await expect.element(page.getByRole('heading', { level: 1, name: '契約' })).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { level: 2, name: '現在プラン' })).toBeInTheDocument();
	});

	it('redirects non org-admin users away from contracts', async () => {
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: false
		});
		mocks.resolvePortalHomePath.mockReturnValue('/participant/home');

		render(ContractsPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/participant/home');
		});
	});
});
