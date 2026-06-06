import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NotificationsRoute from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/org-one/room-a/admin/notifications'),
	loadNotificationOutboxList: vi.fn(),
	loadNotificationOutboxDetail: vi.fn(),
	applyNotificationOutboxAction: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	url: new URL('https://example.com/org-one/room-a/admin/notifications')
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

vi.mock('$lib/features/notification-outbox', () => ({
	loadNotificationOutboxList: mocks.loadNotificationOutboxList,
	loadNotificationOutboxDetail: mocks.loadNotificationOutboxDetail,
	applyNotificationOutboxAction: mocks.applyNotificationOutboxAction
}));

vi.mock('svelte-sonner', () => ({
	toast: {
		error: mocks.toastError,
		success: mocks.toastSuccess
	}
}));

const deadNotification = {
	id: 'outbox-dead-1',
	organizationId: 'org-1',
	storeId: 'store-1',
	bookingId: 'booking-1',
	participantId: null,
	eventType: 'booking.confirmed',
	templateKey: 'booking_confirmed',
	channel: 'email',
	recipientType: 'customer',
	recipientEmail: 'dead@example.com',
	recipientName: null,
	subjectSnapshot: '予約が確定しました',
	status: 'dead',
	scheduledFor: '2026-06-06T00:00:00.000Z',
	nextAttemptAt: '2026-06-06T00:00:00.000Z',
	attemptCount: 5,
	maxAttempts: 5,
	idempotencyKey: 'booking.confirmed:booking-1:customer:dead@example.com',
	lockedAt: null,
	lockedBy: null,
	lockExpiresAt: null,
	provider: 'resend',
	providerMessageId: null,
	lastError: 'resend_delivery_failed',
	sentAt: null,
	cancelledAt: null,
	deadAt: '2026-06-06T00:05:00.000Z',
	createdAt: '2026-06-06T00:00:00.000Z',
	updatedAt: '2026-06-06T00:05:00.000Z'
} as const;

const retryNotification = {
	...deadNotification,
	status: 'retry',
	lastError: null,
	deadAt: null,
	nextAttemptAt: '2026-06-06T00:10:00.000Z',
	updatedAt: '2026-06-06T00:06:00.000Z'
} as const;

describe('通知一覧ページ', () => {
	beforeEach(() => {
		pageState.url = new URL('https://example.com/org-one/room-a/admin/notifications');
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadNotificationOutboxList.mockReset();
		mocks.loadNotificationOutboxDetail.mockReset();
		mocks.applyNotificationOutboxAction.mockReset();
		mocks.toastError.mockReset();
		mocks.toastSuccess.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			canManageStore: true,
			activeContext: {
				orgSlug: 'org-one',
				storeSlug: 'room-a'
			}
		});
		mocks.resolvePortalHomePath.mockReturnValue('/admin/bookings');
		mocks.getCurrentPathWithSearch.mockReturnValue('/org-one/room-a/admin/notifications');
		mocks.loadNotificationOutboxList.mockResolvedValue({
			notifications: [deadNotification]
		});
		mocks.loadNotificationOutboxDetail.mockResolvedValue({
			notification: deadNotification,
			logs: [
				{
					id: 'log-1',
					outboxId: deadNotification.id,
					status: 'failed',
					attemptNumber: 5,
					provider: 'resend',
					providerMessageId: null,
					errorMessage: 'resend_delivery_failed',
					responseJson: null,
					createdAt: '2026-06-06T00:05:00.000Z'
				}
			]
		});
		mocks.applyNotificationOutboxAction.mockResolvedValue({
			ok: true,
			status: 200,
			message: '通知状態を更新しました。',
			detail: {
				notification: retryNotification,
				logs: [
					{
						id: 'log-2',
						outboxId: deadNotification.id,
						status: 'manual_retry',
						attemptNumber: 5,
						provider: 'resend',
						providerMessageId: null,
						errorMessage: 'Manual retry was requested.',
						responseJson: null,
						createdAt: '2026-06-06T00:06:00.000Z'
					}
				]
			}
		});
		vi.spyOn(window, 'confirm').mockReturnValue(true);
	});

	it('通知 outbox 一覧を表示して詳細と手動 retry を実行する', async () => {
		render(NotificationsRoute);

		await expect
			.element(page.getByRole('heading', { level: 1, name: '通知一覧' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('dead@example.com')).toBeInTheDocument();
		await expect.element(page.getByText('5/5')).toBeInTheDocument();

		await page.getByRole('button', { name: '詳細' }).click();
		await vi.waitFor(() => {
			expect(mocks.loadNotificationOutboxDetail).toHaveBeenCalledWith(
				{ orgSlug: 'org-one', storeSlug: 'room-a' },
				'outbox-dead-1'
			);
		});
		await expect.element(page.getByText('resend_delivery_failed').first()).toBeInTheDocument();

		await page.getByRole('button', { name: '再試行' }).click();
		await vi.waitFor(() => {
			expect(mocks.applyNotificationOutboxAction).toHaveBeenCalledWith(
				{ orgSlug: 'org-one', storeSlug: 'room-a' },
				'outbox-dead-1',
				'retry'
			);
		});
		expect(mocks.toastSuccess).toHaveBeenCalledWith('通知状態を更新しました。');
	});

	it('絞り込み条件を指定して通知 outbox を検索する', async () => {
		render(NotificationsRoute);

		await expect.element(page.getByText('dead@example.com')).toBeInTheDocument();
		await page.getByLabelText('ステータス').selectOptions('dead');
		await page.getByLabelText('通知種別').selectOptions('booking.confirmed');
		await page.getByLabelText('宛先メール').fill('dead@example.com');
		await page.getByRole('button', { name: '検索' }).click();

		await vi.waitFor(() => {
			expect(mocks.loadNotificationOutboxList).toHaveBeenLastCalledWith(
				{ orgSlug: 'org-one', storeSlug: 'room-a' },
				{
					limit: 50,
					status: 'dead',
					eventType: 'booking.confirmed',
					recipientEmail: 'dead@example.com'
				}
			);
		});
	});
});
