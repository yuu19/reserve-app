import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/org-one/room-a/admin/invitations'),
	loadOrganizations: vi.fn(),
	loadOrganizationBilling: vi.fn(),
	loadStoreInvitations: vi.fn(),
	createStoreInvitation: vi.fn(),
	actOperatorInvitation: vi.fn()
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession,
	redirectToLoginWithNext: mocks.redirectToLoginWithNext,
	getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
}));

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizations: mocks.loadOrganizations,
	loadOrganizationBilling: mocks.loadOrganizationBilling
}));

vi.mock('$lib/features/scoped-routing', () => ({
	preserveScopedRouteContext: (targetPath: string) => targetPath,
	readWindowScopedRouteContext: () => ({
		orgSlug: 'org-one',
		storeSlug: 'room-a'
	})
}));

vi.mock('$lib/features/invitations-store.svelte', () => ({
	loadStoreInvitations: mocks.loadStoreInvitations,
	createStoreInvitation: mocks.createStoreInvitation,
	actOperatorInvitation: mocks.actOperatorInvitation
}));

vi.mock('svelte-sonner', () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn()
	}
}));

const { default: StoreInvitationsPage } = await import('./+page.svelte');

describe('スコープ付き店舗招待管理ページ', () => {
	beforeEach(() => {
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadOrganizations.mockReset();
		mocks.loadOrganizationBilling.mockReset();
		mocks.loadStoreInvitations.mockReset();
		mocks.createStoreInvitation.mockReset();
		mocks.actOperatorInvitation.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/org-one/room-a/admin/invitations');
		mocks.loadOrganizations.mockResolvedValue({
			activeOrganization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
			activeStore: { id: 'class-1', name: 'Room A', slug: 'room-a' }
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
		mocks.loadStoreInvitations.mockResolvedValue({
			organizationId: 'org-1',
			operatorInvitations: [],
			participantInvitations: [],
			canManageStore: true,
			canManageParticipants: true,
			premiumRestriction: null
		});
		mocks.createStoreInvitation.mockResolvedValue({
			ok: true,
			message: 'ok'
		});
		mocks.actOperatorInvitation.mockResolvedValue({
			ok: true,
			message: 'ok'
		});
	});

	it('店舗招待の見出しを表示する', async () => {
		render(StoreInvitationsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '店舗招待' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '送信済み店舗運営招待' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '送信済み参加者招待' }))
			.toBeInTheDocument();
	});

	it('店舗招待管理がプレミアム制限されている場合は制限案内を表示する', async () => {
		mocks.loadStoreInvitations.mockResolvedValue({
			organizationId: 'org-1',
			operatorInvitations: [],
			participantInvitations: [],
			canManageStore: false,
			canManageParticipants: false,
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

		render(StoreInvitationsPage);

		await expect
			.element(
				page.getByRole('heading', {
					level: 2,
					name: '店舗招待と参加者招待管理には Premiumプランが必要です'
				})
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByText(/契約変更と支払い設定は組織オーナーのみです/))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '契約画面を開く' }))
			.not.toBeInTheDocument();
	});
});
