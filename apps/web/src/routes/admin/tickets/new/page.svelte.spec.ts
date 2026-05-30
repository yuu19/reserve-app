import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminTicketsNewPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/tickets/new'),
	loadTicketManagementPageData: vi.fn(),
	loadOrganizationBilling: vi.fn(),
	createTicketType: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	url: new URL('https://example.com/admin/tickets/new')
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/state', () => ({
	page: pageState
}));

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
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

vi.mock('$lib/features/tickets.svelte', () => ({
	createTicketType: mocks.createTicketType
}));

describe('回数券種別作成ページ', () => {
	beforeEach(() => {
		pageState.url = new URL('https://example.com/admin/tickets/new');
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadTicketManagementPageData.mockReset();
		mocks.loadOrganizationBilling.mockReset();
		mocks.createTicketType.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/tickets/new');
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
			participants: [],
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
				},
				{
					id: 'service-2',
					organizationId: 'org-1',
					storeId: 'room-1',
					name: 'Pilates',
					description: null,
					durationMinutes: 45,
					price: 1200,
					requiresTicket: false,
					isActive: true,
					imageKey: null,
					imageUrl: null,
					createdAt: '2026-03-01T00:00:00.000Z',
					updatedAt: '2026-03-01T00:00:00.000Z'
				}
			],
			ticketTypes: [],
			ticketPurchases: [],
			loadError: null
		});
		mocks.createTicketType.mockResolvedValue({
			ok: true,
			status: 201,
			premiumRestriction: null,
			message: '回数券種別を作成しました。'
		});
	});

	it('回数券種別作成フォームを専用ページとして表示する', async () => {
		render(AdminTicketsNewPage);

		await expect
			.element(page.getByRole('heading', { level: 1, name: '回数券種別作成' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '回数券管理へ戻る' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '回数券種別作成' }))
			.toBeInTheDocument();
		await expect.element(page.getByLabelText('券種名')).toBeInTheDocument();
		await expect.element(page.getByLabelText('回数')).toBeInTheDocument();
		await expect.element(page.getByLabelText('有効日数（任意）')).toBeInTheDocument();
		await expect.element(page.getByLabelText('すべてのサービス')).toBeInTheDocument();
		await expect.element(page.getByLabelText('サービスを個別指定')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '作成する' })).toBeInTheDocument();
	});

	it('特定サービススコープを選択した場合は 1 つ以上のサービスを要求する', async () => {
		render(AdminTicketsNewPage);

		await page.getByLabelText('サービスを個別指定').click();
		await expect.element(page.getByRole('button', { name: '作成する' })).toBeDisabled();

		await page.getByLabelText('Yoga').click();

		await expect.element(page.getByRole('button', { name: '作成する' })).not.toBeDisabled();
	});

	it('回数券種別を作成し回数券管理ページへ戻る', async () => {
		render(AdminTicketsNewPage);

		await page.getByLabelText('券種名').fill('平日5回券');
		await page.getByLabelText('回数').fill('5');
		await page.getByLabelText('サービスを個別指定').click();
		await page.getByLabelText('Yoga').click();
		await page.getByLabelText('参加者が購入できるようにする').click();
		await page.getByRole('button', { name: '作成する' }).click();

		await vi.waitFor(() => {
			expect(mocks.createTicketType).toHaveBeenCalledWith({
				organizationId: 'org-1',
				name: '平日5回券',
				totalCount: 5,
				expiresInDays: undefined,
				serviceScope: 'specific',
				serviceIds: ['service-1'],
				isForSale: true
			});
			expect(mocks.goto).toHaveBeenCalledWith('/admin/tickets');
		});
	});

	it('スコープ付き URL から作成した後はスコープ付き回数券管理ページへ戻る', async () => {
		pageState.url = new URL('https://example.com/org-one/room-a/admin/tickets/new');

		render(AdminTicketsNewPage);

		await page.getByLabelText('券種名').fill('平日5回券');
		await page.getByLabelText('回数').fill('5');
		await page.getByRole('button', { name: '作成する' }).click();

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/org-one/room-a/admin/tickets');
		});
	});
});
