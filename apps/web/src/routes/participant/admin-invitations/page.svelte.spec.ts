import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/participant/admin-invitations'),
	loadReceivedOperatorInvitations: vi.fn(),
	actOperatorInvitation: vi.fn(),
	loadOrganizationBilling: vi.fn()
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
		loadSession: mocks.loadSession,
		redirectToLoginWithNext: mocks.redirectToLoginWithNext,
		getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
}));

vi.mock('$lib/features/invitations-classroom.svelte', () => ({
	loadReceivedOperatorInvitations: mocks.loadReceivedOperatorInvitations,
	actOperatorInvitation: mocks.actOperatorInvitation
}));

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizationBilling: mocks.loadOrganizationBilling
}));

vi.mock('svelte-sonner', () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn()
	}
}));

const { default: ParticipantAdminInvitationsPage } = await import('./+page.svelte');

describe('/participant/admin-invitations/+page.svelte', () => {
	beforeEach(() => {
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadReceivedOperatorInvitations.mockReset();
		mocks.actOperatorInvitation.mockReset();
		mocks.loadOrganizationBilling.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/participant/admin-invitations');
		mocks.loadReceivedOperatorInvitations.mockResolvedValue({
			received: []
		});
		mocks.actOperatorInvitation.mockResolvedValue({
			ok: true,
			message: 'ok'
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
	});

	it('should render participant operator invitation heading', async () => {
		render(ParticipantAdminInvitationsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '受信した運営招待' }))
			.toBeInTheDocument();
	});

	it('shows premium restriction guidance when operator invitation acceptance is blocked', async () => {
		mocks.loadReceivedOperatorInvitations.mockResolvedValue({
			received: [
				{
					id: 'invite-1',
					subjectKind: 'classroom_operator',
					role: 'staff',
					organizationId: 'org-1',
					organizationSlug: 'org-one',
					organizationName: 'Org One',
					classroomId: 'class-1',
					classroomSlug: 'room-a',
					classroomName: 'Room A',
					email: 'user@example.com',
					participantName: null,
					status: 'pending',
					expiresAt: null,
					createdAt: null,
					invitedByUserId: null,
					respondedByUserId: null,
					respondedAt: null
				}
			]
		});
		mocks.actOperatorInvitation.mockResolvedValue({
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
			}
		});

		render(ParticipantAdminInvitationsPage);

		await page.getByRole('button', { name: '承諾' }).click();

		await expect
			.element(page.getByRole('heading', { level: 2, name: '運営招待の承諾には Premiumプランが必要です' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '契約画面を開く' }))
			.not.toBeInTheDocument();
	});
});
