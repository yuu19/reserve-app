import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EventsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	loadPublicEvents: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	params: {} as Record<string, string | undefined>
}));

vi.mock('$app/state', () => ({
	page: pageState
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$lib/features/events.svelte', () => ({
	loadPublicEvents: mocks.loadPublicEvents
}));

describe('/events/+page.svelte', () => {
	beforeEach(() => {
		pageState.params = {};
		mocks.loadPublicEvents.mockReset();

		mocks.loadPublicEvents.mockResolvedValue({
			events: [
				{
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
					requiresTicket: false,
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
					locationLabel: '第1スタジオ'
				}
			],
			ticketTypes: [
				{
					id: 'ticket-all',
					name: '公開回数券',
					totalCount: 5,
					expiresInDays: 90,
					serviceScope: 'all',
					serviceIds: [],
					serviceNames: [],
					href: '/org-one/room-one/tickets/ticket-all'
				}
			]
		});
	});

	it('should render public events heading and description', async () => {
		render(EventsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '公開イベント' }))
			.toBeInTheDocument();
		await expect
			.element(
				page.getByText('イベント閲覧はログイン不要です。参加登録・予約操作はログイン後に行えます。')
			)
			.toBeInTheDocument();
	});

	it('renders purchasable ticket types as detail links', async () => {
		render(EventsPage);

		await expect
			.element(page.getByRole('heading', { level: 2, name: '回数券' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('公開回数券')).toBeInTheDocument();
		await expect.element(page.getByText('対象サービス: すべてのサービス')).toBeInTheDocument();
		const ticketLink = page.getByRole('link', { name: /公開回数券/ }).first();
		await expect
			.element(ticketLink)
			.toHaveAttribute('href', '/org-one/room-one/tickets/ticket-all');
	});

	it('loads scoped public events from route params', async () => {
		pageState.params = { orgSlug: 'org2', storeSlug: 'world' };
		render(EventsPage);

		await vi.waitFor(() => {
			expect(mocks.loadPublicEvents).toHaveBeenCalledWith({
				orgSlug: 'org2',
				storeSlug: 'world'
			});
		});
		const ticketLink = page.getByRole('link', { name: /公開回数券/ }).first();
		await expect
			.element(ticketLink)
			.toHaveAttribute('href', '/org-one/room-one/tickets/ticket-all');
	});

	it('renders event cards as detail links', async () => {
		render(EventsPage);

		const eventLink = page.getByRole('link', { name: /公開ヨガ/ }).first();
		await expect.element(eventLink).toHaveAttribute('href', '/org-one/room-one/events/slot-1');
	});

	it('renders empty ticket message when no ticket type is purchasable', async () => {
		mocks.loadPublicEvents.mockResolvedValueOnce({
			events: [],
			ticketTypes: []
		});
		render(EventsPage);

		await expect.element(page.getByText('現在購入可能な回数券はありません。')).toBeInTheDocument();
		await expect.element(page.getByText('現在公開中のイベントはありません。')).toBeInTheDocument();
	});
});
