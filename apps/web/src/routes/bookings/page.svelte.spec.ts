import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BookingsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	readLastAuthPortal: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/bookings')
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$lib/features/auth-portal-preference', () => ({
	readLastAuthPortal: mocks.readLastAuthPortal
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession,
	loadPortalAccess: mocks.loadPortalAccess,
	resolvePortalHomePath: mocks.resolvePortalHomePath,
	redirectToLoginWithNext: mocks.redirectToLoginWithNext,
	getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
}));

describe('予約入口ページ', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.readLastAuthPortal.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: {}, session: {} },
			status: 200
		});
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
				canManageStore: 'org_role',
				canManageBookings: 'org_role',
				canManageParticipants: 'org_role',
				canUseParticipantBooking: 'participant_record'
			},
			activeDisplay: {
				primaryRole: 'admin',
				badges: ['admin', 'manager', 'participant']
			},
			activeDisplayRole: 'admin',
			hasActiveOrganization: true
		});
		mocks.resolvePortalHomePath.mockReturnValue('/admin/dashboard');
		mocks.getCurrentPathWithSearch.mockReturnValue('/bookings');
	});

	it('固定ポータルが参加者の場合は参加者予約へリダイレクトする', async () => {
		mocks.readLastAuthPortal.mockReturnValue('participant');
		render(BookingsPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/participant/bookings');
		});
	});

	it('参加者ポータルが優先される場合は参加者予約を既定にする', async () => {
		mocks.readLastAuthPortal.mockReturnValue(null);
		mocks.resolvePortalHomePath.mockReturnValue('/participant/home');
		render(BookingsPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/participant/bookings');
		});
	});

	it('固定ポータルが管理者で管理が許可されている場合は管理予約へリダイレクトする', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
		render(BookingsPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/admin/bookings');
		});
	});

	it('管理ポータルアクセスがあるスタッフユーザーを管理予約へリダイレクトする', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: false,
			hasAdminPortalAccess: true,
			hasParticipantAccess: false,
			canManage: false,
			canManageStore: false,
			canManageBookings: true,
			canManageParticipants: true,
			canUseParticipantBooking: false,
			activeOrganizationRole: null,
			activeFacts: {
				orgRole: null,
				storeStaffRole: 'staff',
				hasParticipantRecord: false
			},
			activeSources: {
				canManageOrganization: null,
				canManageStore: null,
				canManageBookings: 'store_member',
				canManageParticipants: 'store_member',
				canUseParticipantBooking: null
			},
			activeDisplay: {
				primaryRole: 'staff',
				badges: ['staff']
			},
			activeDisplayRole: 'staff',
			hasActiveOrganization: true
		});
		mocks.resolvePortalHomePath.mockReturnValue('/admin/bookings');
		render(BookingsPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/admin/bookings');
		});
	});

	it('保存済み管理ポータルが許可されなくなった場合は参加者予約へフォールバックする', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
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
		render(BookingsPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/participant/bookings');
		});
	});
});
