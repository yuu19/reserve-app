import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminParticipantsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/participants'),
	loadParticipantsPageData: vi.fn(),
	loadOrganizationBilling: vi.fn()
}));

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

vi.mock('$app/state', () => ({
	page: {
		url: new URL('http://localhost/admin/participants')
	}
}));

vi.mock('$lib/features/auth-session.svelte', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/auth-session.svelte')>(
		'$lib/features/auth-session.svelte'
	);
	return {
		...actual,
		loadSession: mocks.loadSession,
		redirectToLoginWithNext: mocks.redirectToLoginWithNext,
		getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
	};
});

vi.mock('$lib/features/participants-page.svelte', () => ({
	loadParticipantsPageData: mocks.loadParticipantsPageData
}));

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizationBilling: mocks.loadOrganizationBilling
}));

describe('/admin/participants/+page.svelte', () => {
	beforeEach(() => {
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadParticipantsPageData.mockReset();
		mocks.loadOrganizationBilling.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/participants');
		mocks.loadParticipantsPageData.mockResolvedValue({
			activeContext: {
				orgSlug: 'org-1',
				classroomSlug: 'room-1'
			},
			organizationId: 'org-1',
			canManage: true,
			canManageParticipants: true,
			canManageClassroom: true,
			premiumRestriction: null,
			participants: [],
			sentInvitations: [],
			receivedInvitations: [],
			services: [],
			ticketTypes: [],
			ticketPurchases: [],
			loadError: null
		});
	});

	it('should render admin participants heading', async () => {
		render(AdminParticipantsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '参加者管理' }))
			.toBeInTheDocument();
	});
});
