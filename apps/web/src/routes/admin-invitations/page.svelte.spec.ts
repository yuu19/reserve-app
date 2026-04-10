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
	loadOrganizationBilling: vi.fn(),
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
	loadOrganizations: mocks.loadOrganizations,
	loadOrganizationBilling: mocks.loadOrganizationBilling
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
		mocks.loadOrganizationBilling.mockReset();
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
			canManage: true,
			premiumRestriction: null
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
			canManage: false,
			premiumRestriction: null
		});

		render(AdminInvitationsPage);

		await expect
			.element(page.getByText('利用中の組織を `/admin/dashboard` で選択してください。'))
			.toBeInTheDocument();
	});

	it('shows read-only premium restriction guidance without owner billing action for non-owners', async () => {
		mocks.loadAdminInvitations.mockResolvedValue({
			sent: [],
			received: [],
			canManage: true,
			premiumRestriction: {
				message: 'Organization premium plan is required for this feature.',
				code: 'organization_premium_required',
				source: 'application_billing_state',
				reason: 'organization_plan_is_free',
				entitlementState: 'free_only',
				planState: 'free',
				trialEndsAt: null
			}
		});
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'free',
				planState: 'free',
				billingInterval: null,
				paymentMethodStatus: 'not_started',
				subscriptionStatus: 'free',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: null,
				trialEndsAt: null,
				canViewBilling: true,
				canManageBilling: false
			}
		});

		render(AdminInvitationsPage);

		await expect
			.element(page.getByRole('heading', { level: 2, name: '管理者招待には Premiumプランが必要です' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText(/契約変更と支払い設定は organization owner のみです/))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '契約画面を開く' }))
			.not.toBeInTheDocument();
	});
});
