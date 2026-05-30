import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TicketDetailPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	loadPublicTicketType: vi.fn(),
	loadSession: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	params: {
		orgSlug: 'org-one',
		storeSlug: 'room-one',
		ticketTypeId: 'ticket-1'
	} as Record<string, string | undefined>
}));

vi.mock('$app/state', () => ({
	page: pageState
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$lib/features/public-site.svelte', () => ({
	loadPublicTicketType: mocks.loadPublicTicketType
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession
}));

describe('公開回数券詳細ページ', () => {
	beforeEach(() => {
		pageState.params = {
			orgSlug: 'org-one',
			storeSlug: 'room-one',
			ticketTypeId: 'ticket-1'
		};
		mocks.loadPublicTicketType.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPublicTicketType.mockResolvedValue({
			id: 'ticket-1',
			name: 'ヨガ回数券',
			totalCount: 5,
			expiresInDays: 90,
			serviceScope: 'specific',
			serviceIds: ['service-1'],
			serviceNames: ['公開ヨガ'],
			href: '/org-one/room-one/tickets/ticket-1'
		});
		mocks.loadSession.mockResolvedValue({
			session: null,
			status: 401
		});
	});

	it('回数券詳細と現在の詳細 URL を next にした未ログイン向けログイン CTA を表示する', async () => {
		render(TicketDetailPage);

		await expect
			.element(page.getByRole('heading', { level: 1, name: '回数券詳細' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('ヨガ回数券')).toBeInTheDocument();
		await expect.element(page.getByText('対象サービス: 公開ヨガ')).toBeInTheDocument();
		await expect.element(page.getByText('支払方法: 現地決済 / 銀行振込')).toBeInTheDocument();
		await expect
			.element(page.getByText('購入申請後、運営の承認後に回数券が付与されます。'))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'ログインして購入申請' }))
			.toHaveAttribute(
				'href',
				'/participant/login?next=%2Forg-one%2Froom-one%2Ftickets%2Fticket-1'
			);
		expect(mocks.loadPublicTicketType).toHaveBeenCalledWith({
			orgSlug: 'org-one',
			storeSlug: 'room-one',
			ticketTypeId: 'ticket-1'
		});
	});

	it('ticketTypeId クエリ付き参加者予約へのログイン済み CTA を表示する', async () => {
		mocks.loadSession.mockResolvedValueOnce({
			session: { user: { id: 'user-1' } },
			status: 200
		});

		render(TicketDetailPage);

		await expect
			.element(page.getByRole('link', { name: '購入申請へ進む' }))
			.toHaveAttribute('href', '/org-one/room-one/participant/bookings?ticketTypeId=ticket-1');
	});
});
