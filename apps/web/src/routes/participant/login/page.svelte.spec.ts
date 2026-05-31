import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantLoginPage from './+page.svelte';

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
		url: new URL('https://example.com/participant/login')
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

describe('参加者ログインページ', () => {
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

	it('参加者ログインの見出しを表示する', async () => {
		render(ParticipantLoginPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '予約者ページログイン' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: 'この入口でできること' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: /管理画面ログインへ/ }))
			.toHaveAttribute('href', '/admin/login');
	});

	it('公開イベントへのアクセスがない新規サインインユーザーをリダイレクトする', async () => {
		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: false,
			hasAdminPortalAccess: false,
			hasParticipantAccess: false,
			canManage: false,
			canManageStore: false,
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

		render(ParticipantLoginPage);

		await expect.poll(() => mocks.goto.mock.calls.at(-1)?.[0] ?? null).toBe('/events');
	});
});
