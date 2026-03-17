import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminLoginPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	loadPendingInvitationHomePath: vi.fn()
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$app/state', () => ({
	page: {
		url: new URL('https://example.com/admin/login')
	}
}));

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession,
	loadPortalAccess: mocks.loadPortalAccess,
	loadPendingInvitationHomePath: mocks.loadPendingInvitationHomePath,
	resolvePortalHomePath: mocks.resolvePortalHomePath,
	parseResponseBody: async (response: Response) => response.json(),
	toErrorMessage: (payload: unknown, fallback: string) =>
		typeof payload === 'string' && payload.length > 0 ? payload : fallback
}));

describe('/admin/login/+page.svelte', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.loadPendingInvitationHomePath.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: null,
			status: 200
		});
		mocks.loadPendingInvitationHomePath.mockResolvedValue(null);
	});

	it('should render admin login heading', async () => {
		render(AdminLoginPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '管理画面ログイン' }))
			.toBeInTheDocument();
	});

	it('redirects newly signed-in users without admin portal access to onboarding', async () => {
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
		mocks.resolvePortalHomePath.mockReturnValue(null);

		render(AdminLoginPage);

		await expect
			.poll(() => mocks.goto.mock.calls.at(-1)?.[0] ?? null)
			.toBe('/admin/onboarding');
	});

	it('prefers participant home when the user only has participant access', async () => {
		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-2' }, session: { id: 'session-2' } },
			status: 200
		});
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
		mocks.resolvePortalHomePath.mockReturnValue('/participant/home');

		render(AdminLoginPage);

		await expect
			.poll(() => mocks.goto.mock.calls.at(-1)?.[0] ?? null)
			.toBe('/participant/home');
	});
});
