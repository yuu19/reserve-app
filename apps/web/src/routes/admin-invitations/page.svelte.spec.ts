import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminInvitationsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/invitations'),
	loadOrganizations: vi.fn(),
	loadAdminInvitations: vi.fn()
}));

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/state', () => ({
	page: {
		url: new URL('http://localhost/admin/invitations')
	}
}));

vi.mock('$lib/features/auth-session.svelte', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/auth-session.svelte')>(
		'$lib/features/auth-session.svelte'
	);
	return {
		...actual,
		loadSession: mocks.loadSession,
		redirectToLoginWithNext: mocks.redirectToLoginWithNext,
		getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
	};
});

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizations: mocks.loadOrganizations
}));

vi.mock('$lib/features/invitations-admin.svelte', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/invitations-admin.svelte')>(
		'$lib/features/invitations-admin.svelte'
	);
	return {
		...actual,
		loadAdminInvitations: mocks.loadAdminInvitations
	};
});

describe('/admin-invitations/+page.svelte', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadOrganizations.mockReset();
		mocks.loadAdminInvitations.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/invitations');
		mocks.loadOrganizations.mockResolvedValue({
			organizations: [{ id: 'org-1', name: 'Org One', slug: 'org-one' }],
			activeOrganization: { id: 'org-1', name: 'Org One', slug: 'org-one' }
		});
		mocks.loadAdminInvitations.mockResolvedValue({
			sent: [],
			received: [],
			canManage: true
		});
	});

	it('should render admin invitations heading', async () => {
		render(AdminInvitationsPage);
		await expect.element(page.getByRole('heading', { level: 1, name: '管理者招待' })).toBeInTheDocument();
	});

	it('should show loading message and hide organization-required message during initial load', async () => {
		mocks.loadOrganizations.mockImplementation(() => new Promise(() => {}));

		render(AdminInvitationsPage);

		await expect.element(page.getByText('招待データを読み込み中…')).toBeInTheDocument();
		await expect
			.element(page.getByText('利用中の組織を `/admin/dashboard` で選択してください。'))
			.not.toBeInTheDocument();
	});

	it('should show organization-required message after load when no active organization', async () => {
		mocks.loadOrganizations.mockResolvedValue({
			organizations: [{ id: 'org-1', name: 'Org One', slug: 'org-one' }],
			activeOrganization: null
		});
		mocks.loadAdminInvitations.mockResolvedValue({
			sent: [],
			received: [],
			canManage: false
		});

		render(AdminInvitationsPage);

		await expect
			.element(page.getByText('利用中の組織を `/admin/dashboard` で選択してください。'))
			.toBeInTheDocument();
	});
});
