import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PublicSiteTopPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadPublicSitePage: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	params: {
		orgSlug: 'org-one',
		classroomSlug: 'room-one'
	}
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$app/state', () => ({
	page: pageState
}));

vi.mock('$lib/features/public-site.svelte', () => ({
	loadPublicSitePage: mocks.loadPublicSitePage
}));

describe('/[orgSlug]/[classroomSlug]/+page.svelte', () => {
	beforeEach(() => {
		pageState.params = {
			orgSlug: 'org-one',
			classroomSlug: 'room-one'
		};
		mocks.goto.mockReset();
		mocks.loadPublicSitePage.mockReset();
		mocks.loadPublicSitePage.mockResolvedValue({
			site: {
				organizationId: 'org-1',
				organizationSlug: 'org-one',
				organizationName: 'Org One',
				classroomId: 'room-1',
				classroomSlug: 'room-one',
				classroomName: 'Room One',
				siteName: 'Tokyo Studio',
				description: '公開サイトの説明',
				address: '東京都千代田区1-1-1',
				phone: '03-0000-0000',
				businessHours: '平日 10:00-18:00',
				imageUrl: 'https://cdn.example.com/studio.webp'
			},
			bookingPages: [
				{
					id: 'slot-1',
					kind: 'event',
					title: '公開ヨガ',
					description: '朝のヨガ',
					imageUrl: null,
					href: '/org-one/room-one/events/slot-1',
					serviceId: 'service-1',
					slotId: 'slot-1',
					startAt: '2026-06-01T01:00:00.000Z',
					endAt: '2026-06-01T02:00:00.000Z',
					remainingCount: 7,
					capacity: 8,
					isBookable: true,
					locationLabel: '第1スタジオ'
				}
			],
			ticketTypes: [
				{
					id: 'ticket-1',
					name: 'ヨガ回数券',
					totalCount: 5,
					expiresInDays: 90,
					serviceScope: 'specific',
					serviceIds: ['service-1'],
					serviceNames: ['公開ヨガ']
				}
			]
		});
	});

	it('renders public site profile, booking pages, and ticket types', async () => {
		render(PublicSiteTopPage);

		await expect
			.element(page.getByRole('heading', { level: 1, name: 'Tokyo Studio' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('公開サイトの説明')).toBeInTheDocument();
		await expect.element(page.getByText('住所: 東京都千代田区1-1-1')).toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '予約ページ一覧' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3, name: '公開ヨガ' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3, name: 'ヨガ回数券' }))
			.toBeInTheDocument();

		expect(mocks.loadPublicSitePage).toHaveBeenCalledWith({
			orgSlug: 'org-one',
			classroomSlug: 'room-one'
		});
	});

	it('opens a booking page from the top page', async () => {
		render(PublicSiteTopPage);

		await page.getByRole('button', { name: '予約ページへ', exact: true }).click();

		expect(mocks.goto).toHaveBeenCalledWith('/org-one/room-one/events/slot-1');
	});
});
