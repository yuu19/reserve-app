import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DashboardPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/dashboard'),
	loadOrganizations: vi.fn(),
	loadParticipantFeatureData: vi.fn()
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$app/state', () => ({
	page: {
		url: new URL('https://example.com/admin/dashboard')
	}
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

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizations: mocks.loadOrganizations
}));

vi.mock('$lib/features/invitations-participant.svelte', () => ({
	loadParticipantFeatureData: mocks.loadParticipantFeatureData
}));

describe('/dashboard/+page.svelte', () => {
	beforeEach(() => {
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadOrganizations.mockReset();
		mocks.loadParticipantFeatureData.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
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
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/dashboard');
		mocks.loadParticipantFeatureData.mockResolvedValue({
			participants: [],
			sent: []
		});
	});

	it('renders active organization logo in dashboard card', async () => {
		mocks.loadOrganizations.mockResolvedValue({
			organizations: [
				{
					id: 'org-1',
					name: 'yusuke',
					slug: 'hoge',
					logo: 'https://cdn.example.com/yusuke.webp'
				}
			],
			activeOrganization: {
				id: 'org-1',
				name: 'yusuke',
				slug: 'hoge',
				logo: 'https://cdn.example.com/yusuke.webp'
			}
		});

		render(DashboardPage);

		await expect.element(page.getByRole('heading', { level: 1, name: 'ダッシュボード' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '設定へ移動' })).toBeInTheDocument();
		await expect.element(page.getByText('yusuke')).toBeInTheDocument();

		const logoImage = document.querySelector(
			'img[data-slot="organization-logo-image"][alt="yusuke のロゴ"]'
		) as HTMLImageElement | null;
		expect(logoImage?.getAttribute('src')).toBe('https://cdn.example.com/yusuke.webp');
	});

	it('shows fallback text when active organization is not selected', async () => {
		mocks.loadOrganizations.mockResolvedValue({
			organizations: [],
			activeOrganization: null
		});

		render(DashboardPage);

		await expect.element(page.getByText('選択されていません')).toBeInTheDocument();
	});
});
