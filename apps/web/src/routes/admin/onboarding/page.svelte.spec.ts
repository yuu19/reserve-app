import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminOnboardingPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	loadPendingInvitationHomePath: vi.fn()
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession,
	loadPortalAccess: mocks.loadPortalAccess,
	loadPendingInvitationHomePath: mocks.loadPendingInvitationHomePath,
	resolvePortalHomePath: vi.fn(() => null),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/onboarding')
}));

vi.mock('$lib/features/organization-context.svelte', () => ({
	createOrganizationWithInitialClassroom: vi.fn(),
	uploadOrganizationLogo: vi.fn()
}));

describe('/admin/onboarding/+page.svelte', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.loadPendingInvitationHomePath.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: false,
			hasAdminPortalAccess: false,
			hasParticipantAccess: false,
			canManage: false,
			canManageClassroom: false,
			canManageBookings: false,
			canManageParticipants: false,
			canUseParticipantBooking: false,
			activeOrganizationRole: null,
			activeFacts: null,
			activeSources: null,
			activeDisplay: null,
			activeDisplayRole: null,
			hasActiveOrganization: false
		});
		mocks.loadPendingInvitationHomePath.mockResolvedValue(null);
	});

	it('renders onboarding heading for users without portal access', async () => {
		render(AdminOnboardingPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '最初の組織と教室を作成' }))
			.toBeInTheDocument();
	});

	it('redirects participant-only users away from onboarding', async () => {
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: false,
			hasAdminPortalAccess: false,
			hasParticipantAccess: true,
			canManage: false,
			canManageClassroom: false,
			canManageBookings: false,
			canManageParticipants: false,
			canUseParticipantBooking: true,
			activeOrganizationRole: null,
			activeFacts: null,
			activeSources: null,
			activeDisplay: null,
			activeDisplayRole: 'participant',
			hasActiveOrganization: true
		});

		render(AdminOnboardingPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/participant/home');
		});
	});
});
