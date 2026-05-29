import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StoresPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/stores'),
	resolvePortalHomePath: vi.fn(() => '/participant/home'),
	loadOrganizations: vi.fn(),
	listStoresByOrgSlug: vi.fn(),
	createStore: vi.fn(),
	updateStore: vi.fn(),
	loadOrganizationBilling: vi.fn()
}));

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$lib/features/auth-session.svelte', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/auth-session.svelte')>(
		'$lib/features/auth-session.svelte'
	);
	return {
		...actual,
		loadSession: mocks.loadSession,
		loadPortalAccess: mocks.loadPortalAccess,
		redirectToLoginWithNext: mocks.redirectToLoginWithNext,
		getCurrentPathWithSearch: mocks.getCurrentPathWithSearch,
		resolvePortalHomePath: mocks.resolvePortalHomePath
	};
});

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizations: mocks.loadOrganizations,
	listStoresByOrgSlug: mocks.listStoresByOrgSlug,
	createStore: mocks.createStore,
	updateStore: mocks.updateStore,
	loadOrganizationBilling: mocks.loadOrganizationBilling
}));

describe('/admin/stores/+page.svelte', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.loadOrganizations.mockReset();
		mocks.listStoresByOrgSlug.mockReset();
		mocks.createStore.mockReset();
		mocks.updateStore.mockReset();
		mocks.loadOrganizationBilling.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: true
		});
		mocks.loadOrganizations.mockResolvedValue({
			activeOrganization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
			activeStore: null
		});
		mocks.listStoresByOrgSlug.mockResolvedValue([]);
		mocks.createStore.mockResolvedValue({
			ok: true,
			status: 200,
			message: '店舗を作成しました。',
			premiumRestriction: null,
			store: {
				id: 'room-1',
				slug: 'room-1',
				name: 'Room 1',
				display: { primaryRole: 'manager' },
				facts: {},
				sources: {},
				canManage: true,
				canManageStore: true,
				canManageBookings: true,
				canManageParticipants: true,
				canUseParticipantBooking: true
			}
		});
	});

	it('shows premium restriction guidance after store creation is denied by premium gating', async () => {
		mocks.createStore.mockResolvedValue({
			ok: false,
			status: 403,
			message: 'この機能は組織のPremiumプランで利用できます。',
			premiumRestriction: {
				message: 'Organization premium plan is required for this feature.',
				code: 'organization_premium_required',
				source: 'application_billing_state',
				reason: 'organization_plan_is_free',
				entitlementState: 'free_only',
				planState: 'free',
				trialEndsAt: null
			},
			store: null
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
				canManageBilling: true
			}
		});

		render(StoresPage);

		await expect
			.element(page.getByRole('heading', { level: 2, name: '店舗を作成' }))
			.toBeInTheDocument();
		await page.getByLabelText('店舗名').fill('Premium Room');
		await page.getByRole('button', { name: '店舗を作成' }).click();

		await vi.waitFor(() => {
			expect(mocks.createStore).toHaveBeenCalledWith('org-one', {
				name: 'Premium Room',
				slug: 'premium-room'
			});
		});
		await expect
			.element(
				page.getByRole('heading', { level: 2, name: '複数店舗管理には Premiumプランが必要です' })
			)
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '契約画面を開く' })).toBeInTheDocument();
	});
});
