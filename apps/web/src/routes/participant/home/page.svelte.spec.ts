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

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
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

describe('/participant/home/+page.svelte', () => {
	beforeEach(() => {
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
		mocks.getCurrentPathWithSearch.mockReturnValue('/participant/home');
	});

	it('should render participant home heading', async () => {
		render(ParticipantHomePage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '参加者ホーム' }))
			.toBeInTheDocument();
	});

	it('redirects to admin dashboard when manage portal is preferred', async () => {
		mocks.resolvePortalHomePath.mockReturnValue('/admin/dashboard');
		render(ParticipantHomePage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/admin/dashboard');
		});
	});
});
