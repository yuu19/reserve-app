import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantHomePage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/participant/home')
}));

const pageState = vi.hoisted(() => ({
	url: new URL('https://example.com/participant/home')
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/state', () => ({
	page: pageState
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession,
	loadPortalAccess: mocks.loadPortalAccess,
	resolvePortalHomePath: mocks.resolvePortalHomePath,
	redirectToLoginWithNext: mocks.redirectToLoginWithNext,
	getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
}));

describe('参加者ホームページ', () => {
	beforeEach(() => {
		pageState.url = new URL('https://example.com/participant/home');
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'participant-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: false,
			hasAdminPortalAccess: false,
			hasParticipantAccess: true,
			canManage: false,
			canManageStore: false,
			canManageBookings: false,
			canManageParticipants: false,
			canUseParticipantBooking: true,
			activeOrganizationRole: null,
			activeFacts: {
				orgRole: null,
				storeStaffRole: null,
				hasParticipantRecord: true
			},
			activeSources: {
				canManageOrganization: null,
				canManageStore: null,
				canManageBookings: null,
				canManageParticipants: null,
				canUseParticipantBooking: 'participant_record'
			},
			activeDisplay: {
				primaryRole: 'participant',
				badges: ['participant']
			},
			activeDisplayRole: 'participant',
			hasActiveOrganization: true
		});
		mocks.resolvePortalHomePath.mockReturnValue('/participant/home');
		mocks.getCurrentPathWithSearch.mockReturnValue('/participant/home');
	});

	it('参加者ホームの見出しを表示する', async () => {
		render(ParticipantHomePage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '参加者ホーム' }))
			.toBeInTheDocument();
	});

	it('管理ポータルが優先される場合は管理ダッシュボードへリダイレクトする', async () => {
		mocks.resolvePortalHomePath.mockReturnValue('/admin/dashboard');
		render(ParticipantHomePage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/admin/dashboard');
		});
	});

	it('アクティブコンテキストがある場合はスコープ付き管理ダッシュボードへリダイレクトする', async () => {
		mocks.resolvePortalHomePath.mockReturnValue('/admin/dashboard');
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: true,
			hasAdminPortalAccess: true,
			hasParticipantAccess: true,
			canManage: true,
			canManageStore: true,
			canManageBookings: true,
			canManageParticipants: true,
			canUseParticipantBooking: true,
			activeOrganizationRole: 'admin',
			activeFacts: {
				orgRole: 'admin',
				storeStaffRole: 'manager',
				hasParticipantRecord: true
			},
			activeSources: {
				canManageOrganization: 'org_role',
				canManageStore: 'store_staff',
				canManageBookings: 'store_staff',
				canManageParticipants: 'store_staff',
				canUseParticipantBooking: 'participant_record'
			},
			activeDisplay: {
				primaryRole: 'manager',
				badges: ['manager', 'participant']
			},
			activeDisplayRole: 'manager',
			hasActiveOrganization: true,
			activeContext: {
				orgSlug: 'org-one',
				storeSlug: 'room-a'
			}
		});

		render(ParticipantHomePage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/org-one/room-a/admin/dashboard');
		});
	});
});
