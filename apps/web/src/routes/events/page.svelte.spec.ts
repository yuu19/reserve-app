import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EventsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadPublicEvents: vi.fn(),
	loadSession: vi.fn()
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$lib/features/events.svelte', () => ({
	loadPublicEvents: mocks.loadPublicEvents
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession
}));

describe('/events/+page.svelte', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.loadPublicEvents.mockReset();
		mocks.loadSession.mockReset();

		mocks.loadPublicEvents.mockResolvedValue({
			events: [
				{
					organizationId: 'org-1',
					organizationSlug: 'org-one',
					classroomId: 'room-1',
					classroomSlug: 'room-one',
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
					serviceNames: []
				}
			]
		});
		mocks.loadSession.mockResolvedValue({
			session: null,
			status: 401
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

	it('renders purchasable ticket types with participant login CTA', async () => {
		render(EventsPage);

		await expect
			.element(page.getByRole('heading', { level: 2, name: '回数券' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('公開回数券')).toBeInTheDocument();
		await expect.element(page.getByText('対象サービス: すべてのサービス')).toBeInTheDocument();
		const loginCta = page.getByRole('link', { name: 'ログインして購入申請' }).first();
		await expect
			.element(loginCta)
			.toHaveAttribute('href', '/participant/login?next=%2Fparticipant%2Fbookings');
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
