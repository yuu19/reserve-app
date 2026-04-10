import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/org-one/room-a/admin/invitations'),
	loadOrganizations: vi.fn(),
	loadOrganizationBilling: vi.fn(),
	loadClassroomInvitations: vi.fn(),
	createClassroomInvitation: vi.fn(),
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
	readWindowScopedRouteContext: () => ({
		orgSlug: 'org-one',
		classroomSlug: 'room-a'
	})
}));

vi.mock('$lib/features/invitations-classroom.svelte', () => ({
	loadClassroomInvitations: mocks.loadClassroomInvitations,
	createClassroomInvitation: mocks.createClassroomInvitation,
	actOperatorInvitation: mocks.actOperatorInvitation
}));

vi.mock('svelte-sonner', () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn()
	}
}));

const { default: ClassroomInvitationsPage } = await import('./+page.svelte');

describe('/[orgSlug]/[classroomSlug]/admin/invitations/+page.svelte', () => {
	beforeEach(() => {
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadOrganizations.mockReset();
		mocks.loadOrganizationBilling.mockReset();
		mocks.loadClassroomInvitations.mockReset();
		mocks.createClassroomInvitation.mockReset();
		mocks.actOperatorInvitation.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/org-one/room-a/admin/invitations');
		mocks.loadOrganizations.mockResolvedValue({
			activeOrganization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
			activeClassroom: { id: 'class-1', name: 'Room A', slug: 'room-a' }
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
		mocks.loadClassroomInvitations.mockResolvedValue({
			organizationId: 'org-1',
			operatorInvitations: [],
			participantInvitations: [],
			canManageClassroom: true,
			canManageParticipants: true,
			premiumRestriction: null
		});
		mocks.createClassroomInvitation.mockResolvedValue({
			ok: true,
			message: 'ok'
		});
		mocks.actOperatorInvitation.mockResolvedValue({
			ok: true,
			message: 'ok'
		});
	});

	it('should render classroom invitations heading', async () => {
		render(ClassroomInvitationsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '教室招待' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '送信済み教室運営招待' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '送信済み参加者招待' }))
			.toBeInTheDocument();
	});

	it('shows premium restriction guidance when classroom invitation management is premium-gated', async () => {
		mocks.loadClassroomInvitations.mockResolvedValue({
			organizationId: 'org-1',
			operatorInvitations: [],
			participantInvitations: [],
			canManageClassroom: false,
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

		render(ClassroomInvitationsPage);

		await expect
			.element(page.getByRole('heading', { level: 2, name: '教室招待と参加者招待管理には Premiumプランが必要です' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText(/契約変更と支払い設定は organization owner のみです/))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '契約画面を開く' }))
			.not.toBeInTheDocument();
	});
});
