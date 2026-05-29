import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EventDetailPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	loadPublicEventDetail: vi.fn(),
	reservePublicEvent: vi.fn(),
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/events/slot-1')
}));

const pageState = vi.hoisted(() => ({
	params: {
		slotId: 'slot-1'
	} as Record<string, string | undefined>
}));

vi.mock('$app/state', () => ({
	page: pageState
}));

vi.mock('$lib/features/events.svelte', () => ({
	loadPublicEventDetail: mocks.loadPublicEventDetail,
	reservePublicEvent: mocks.reservePublicEvent
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession,
	redirectToLoginWithNext: mocks.redirectToLoginWithNext,
	getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
}));

describe('/events/[slotId]/+page.svelte', () => {
	beforeEach(() => {
		pageState.params = { slotId: 'slot-1' };
		mocks.loadPublicEventDetail.mockReset();
		mocks.reservePublicEvent.mockReset();
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();

		mocks.loadPublicEventDetail.mockResolvedValue({
			organizationId: 'org-1',
			organizationSlug: 'org-one',
			storeId: 'room-1',
			storeSlug: 'room-one',
			serviceId: 'service-1',
			serviceName: '公開ヨガ',
			serviceDescription: '公開イベント説明',
			serviceImageUrl: null,
			serviceKind: 'single',
			bookingPolicy: 'instant',
			requiresTicket: true,
			slotId: 'slot-1',
			startAt: '2026-06-01T01:00:00.000Z',
			endAt: '2026-06-01T02:00:00.000Z',
			slotStatus: 'open',
			capacity: 8,
			reservedCount: 1,
			remainingCount: 7,
			bookingOpenAt: '2026-05-01T00:00:00.000Z',
			bookingCloseAt: '2026-06-01T00:00:00.000Z',
			isBookable: true,
			staffLabel: null,
			locationLabel: '第1スタジオ',
			ticketTypes: [
				{
					id: 'ticket-all',
					name: '全サービス回数券',
					totalCount: 5,
					expiresInDays: 90,
					serviceScope: 'all',
					serviceIds: [],
					serviceNames: [],
					href: '/org-one/room-one/tickets/ticket-all'
				},
				{
					id: 'ticket-specific',
					name: 'ヨガ専用回数券',
					totalCount: 3,
					expiresInDays: null,
					serviceScope: 'specific',
					serviceIds: ['service-1'],
					serviceNames: ['公開ヨガ'],
					href: '/org-one/room-one/tickets/ticket-specific'
				},
				{
					id: 'ticket-other',
					name: '別サービス回数券',
					totalCount: 3,
					expiresInDays: null,
					serviceScope: 'specific',
					serviceIds: ['service-2'],
					serviceNames: ['別サービス'],
					href: '/org-one/room-one/tickets/ticket-other'
				}
			]
		});
		mocks.loadSession.mockResolvedValue({
			session: null,
			status: 401
		});
	});

	it('should render event detail heading and reserve button', async () => {
		render(EventDetailPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: 'イベント詳細' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '参加登録して予約する' }))
			.toBeInTheDocument();
	});

	it('renders only ticket types usable for the current event service', async () => {
		render(EventDetailPage);

		await expect.element(page.getByText('全サービス回数券')).toBeInTheDocument();
		await expect.element(page.getByText('ヨガ専用回数券')).toBeInTheDocument();
		await expect.element(page.getByText('別サービス回数券')).not.toBeInTheDocument();
		const ticketLink = page.getByRole('link', { name: /ヨガ専用回数券/ }).first();
		await expect
			.element(ticketLink)
			.toHaveAttribute('href', '/org-one/room-one/tickets/ticket-specific');
	});

	it('loads scoped public event detail from route params', async () => {
		pageState.params = { orgSlug: 'org2', storeSlug: 'world', slotId: 'slot-1' };
		render(EventDetailPage);

		await vi.waitFor(() => {
			expect(mocks.loadPublicEventDetail).toHaveBeenCalledWith('slot-1', {
				orgSlug: 'org2',
				storeSlug: 'world'
			});
		});
		const ticketLink = page.getByRole('link', { name: /全サービス回数券/ }).first();
		await expect
			.element(ticketLink)
			.toHaveAttribute('href', '/org-one/room-one/tickets/ticket-all');
	});

	it('renders empty message when no ticket type matches this event', async () => {
		mocks.loadPublicEventDetail.mockResolvedValueOnce({
			organizationId: 'org-1',
			organizationSlug: 'org-one',
			storeId: 'room-1',
			storeSlug: 'room-one',
			serviceId: 'service-1',
			serviceName: '公開ヨガ',
			serviceDescription: null,
			serviceImageUrl: null,
			serviceKind: 'single',
			bookingPolicy: 'instant',
			requiresTicket: true,
			slotId: 'slot-1',
			startAt: '2026-06-01T01:00:00.000Z',
			endAt: '2026-06-01T02:00:00.000Z',
			slotStatus: 'open',
			capacity: 8,
			reservedCount: 1,
			remainingCount: 7,
			bookingOpenAt: '2026-05-01T00:00:00.000Z',
			bookingCloseAt: '2026-06-01T00:00:00.000Z',
			isBookable: true,
			staffLabel: null,
			locationLabel: null,
			ticketTypes: [
				{
					id: 'ticket-other',
					name: '別サービス回数券',
					totalCount: 3,
					expiresInDays: null,
					serviceScope: 'specific',
					serviceIds: ['service-2'],
					serviceNames: ['別サービス'],
					href: '/org-one/room-one/tickets/ticket-other'
				}
			]
		});
		render(EventDetailPage);

		await expect.element(page.getByText('現在購入可能な回数券はありません。')).toBeInTheDocument();
	});
});
