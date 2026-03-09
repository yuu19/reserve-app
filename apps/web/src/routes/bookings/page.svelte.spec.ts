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

describe('/bookings/+page.svelte', () => {
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
			hasParticipantAccess: true,
			canManage: true,
			canUseParticipantBooking: true,
			activeOrganizationRole: 'admin',
			activeFacts: {
				orgRole: 'admin',
				classroomStaffRole: 'manager',
				hasParticipantRecord: true
			},
			activeSources: {
				canManageOrganization: 'org_role',
				canManageClassroom: 'org_role',
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

	it('redirects to participant bookings when fixed portal is participant', async () => {
		mocks.readLastAuthPortal.mockReturnValue('participant');
		render(BookingsPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/participant/bookings');
		});
	});

	it('uses participant bookings as default when participant portal is preferred', async () => {
		mocks.readLastAuthPortal.mockReturnValue(null);
		mocks.resolvePortalHomePath.mockReturnValue('/participant/home');
		render(BookingsPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/participant/bookings');
		});
	});

	it('redirects to admin bookings when fixed portal is admin and manage is allowed', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
		render(BookingsPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/admin/bookings');
		});
	});

	it('falls back to participant bookings when stored admin portal is no longer allowed', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: false,
			hasParticipantAccess: true,
			canManage: false,
			canUseParticipantBooking: true,
			activeOrganizationRole: null,
			activeFacts: {
				orgRole: null,
				classroomStaffRole: null,
				hasParticipantRecord: true
			},
			activeSources: {
				canManageOrganization: null,
				canManageClassroom: null,
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
