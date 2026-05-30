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

describe('回数券管理ページ', () => {
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
				storeSlug: 'room-1'
			},
			organizationId: 'org-1',
			canManage: true,
			canManageParticipants: true,
			canManageStore: true,
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
					storeId: 'room-1',
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
					storeId: 'room-1',
					name: '5回券',
					totalCount: 5,
					serviceScope: 'all',
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
					storeId: 'room-1',
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

	it('回数券管理操作を表示する', async () => {
		render(AdminTicketsPage);

		await expect
			.element(page.getByRole('heading', { level: 1, name: '回数券管理' }))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '追加する' })).toBeInTheDocument();
		await expect.element(page.getByText('回数券付与')).toBeInTheDocument();
		await expect.element(page.getByText('発行済み回数券調整')).toBeInTheDocument();
		await expect.element(page.getByText('回数券購入管理')).toBeInTheDocument();
		await expect.element(page.getByText('5回券', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('対象サービス: すべて')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '更新' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '無効化' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '承認' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '却下' })).toBeInTheDocument();
	});

	it('参加者専用操作を参加者管理権限の内側に保つ', async () => {
		mocks.loadTicketManagementPageData.mockResolvedValue({
			activeContext: {
				orgSlug: 'org-1',
				storeSlug: 'room-1'
			},
			organizationId: 'org-1',
			canManage: true,
			canManageParticipants: false,
			canManageStore: true,
			premiumRestriction: null,
			participants: [],
			services: [],
			ticketTypes: [],
			ticketPurchases: [],
			loadError: null
		});

		render(AdminTicketsPage);

		await expect.element(page.getByRole('button', { name: '追加する' })).toBeInTheDocument();
		await expect
			.element(page.getByText('回数券付与には参加者管理権限が必要です。'))
			.toBeInTheDocument();
		await expect
			.element(page.getByText('発行済み回数券の調整には参加者管理権限が必要です。'))
			.toBeInTheDocument();
		await expect
			.element(page.getByText('回数券購入申請の承認には参加者管理権限が必要です。'))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '承認' })).not.toBeInTheDocument();
	});
});
