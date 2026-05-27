import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminTicketsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/tickets'),
	loadTicketManagementPageData: vi.fn(),
	loadOrganizationBilling: vi.fn()
}));

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

vi.mock('$app/state', () => ({
	page: {
		url: new URL('http://localhost/admin/tickets')
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

vi.mock('$lib/features/ticket-management-page.svelte', () => ({
	loadTicketManagementPageData: mocks.loadTicketManagementPageData
}));

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizationBilling: mocks.loadOrganizationBilling
}));

describe('/admin/tickets/+page.svelte', () => {
	beforeEach(() => {
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadTicketManagementPageData.mockReset();
		mocks.loadOrganizationBilling.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/tickets');
		mocks.loadTicketManagementPageData.mockResolvedValue({
			activeContext: {
				orgSlug: 'org-1',
				classroomSlug: 'room-1'
			},
			organizationId: 'org-1',
			canManage: true,
			canManageParticipants: true,
			canManageClassroom: true,
			premiumRestriction: null,
			participants: [
				{
					id: 'participant-1',
					organizationId: 'org-1',
					userId: 'user-1',
					name: 'Participant One',
					email: 'participant@example.com',
					createdAt: '2026-03-01T00:00:00.000Z',
					updatedAt: '2026-03-01T00:00:00.000Z'
				}
			],
			services: [
				{
					id: 'service-1',
					organizationId: 'org-1',
					classroomId: 'room-1',
					name: 'Yoga',
					description: null,
					durationMinutes: 60,
					price: 1000,
					requiresTicket: false,
					isActive: true,
					imageKey: null,
					imageUrl: null,
					createdAt: '2026-03-01T00:00:00.000Z',
					updatedAt: '2026-03-01T00:00:00.000Z'
				}
			],
			ticketTypes: [
				{
					id: 'ticket-type-1',
					organizationId: 'org-1',
					classroomId: 'room-1',
					name: '5回券',
					totalCount: 5,
					expiresInDays: null,
					serviceIds: [],
					isActive: true,
					isForSale: false,
					stripePriceId: null,
					createdAt: '2026-03-01T00:00:00.000Z',
					updatedAt: '2026-03-01T00:00:00.000Z'
				}
			],
			ticketPurchases: [
				{
					id: 'purchase-1',
					organizationId: 'org-1',
					classroomId: 'room-1',
					participantId: 'participant-1',
					ticketTypeId: 'ticket-type-1',
					paymentMethod: 'cash_on_site',
					status: 'pending_approval',
					rejectReason: null,
					createdAt: '2026-03-02T00:00:00.000Z',
					updatedAt: '2026-03-02T00:00:00.000Z'
				}
			],
			loadError: null
		});
	});

	it('renders ticket management operations', async () => {
		render(AdminTicketsPage);

		await expect
			.element(page.getByRole('heading', { level: 1, name: '回数券管理' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('回数券種別作成')).toBeInTheDocument();
		await expect.element(page.getByText('回数券付与')).toBeInTheDocument();
		await expect.element(page.getByText('回数券購入管理')).toBeInTheDocument();
		await expect.element(page.getByText('5回券', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '承認' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '却下' })).toBeInTheDocument();
	});

	it('keeps participant-only operations behind participant management permission', async () => {
		mocks.loadTicketManagementPageData.mockResolvedValue({
			activeContext: {
				orgSlug: 'org-1',
				classroomSlug: 'room-1'
			},
			organizationId: 'org-1',
			canManage: true,
			canManageParticipants: false,
			canManageClassroom: true,
			premiumRestriction: null,
			participants: [],
			services: [],
			ticketTypes: [],
			ticketPurchases: [],
			loadError: null
		});

		render(AdminTicketsPage);

		await expect.element(page.getByText('回数券種別作成')).toBeInTheDocument();
		await expect
			.element(page.getByText('回数券付与には参加者管理権限が必要です。'))
			.toBeInTheDocument();
		await expect
			.element(page.getByText('回数券購入申請の承認には参加者管理権限が必要です。'))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '承認' })).not.toBeInTheDocument();
	});
});
