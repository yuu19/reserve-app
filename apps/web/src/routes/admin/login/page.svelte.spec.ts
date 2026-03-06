import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminLoginPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn()
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$app/state', () => ({
	page: {
		url: new URL('https://example.com/login/admin')
	}
}));

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession,
	loadPortalAccess: mocks.loadPortalAccess,
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

		mocks.loadSession.mockResolvedValue({
			session: null,
			status: 200
		});
	});

	it('should render admin login heading', async () => {
		render(AdminLoginPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '管理画面ログイン' }))
			.toBeInTheDocument();
	});

	it('redirects newly signed-in users without organization access to admin settings', async () => {
		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: false,
			hasParticipantAccess: false,
			canManage: false,
			canUseParticipantBooking: false,
			activeOrganizationRole: null,
			activeClassroomRole: null,
			hasActiveOrganization: false
		});
		mocks.resolvePortalHomePath.mockReturnValue(null);

		render(AdminLoginPage);

		await expect
			.poll(() => mocks.goto.mock.calls.at(-1)?.[0] ?? null)
			.toBe('/admin/settings');
	});
});
