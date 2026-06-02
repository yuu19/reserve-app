import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NotificationSettingsRoute from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/org-one/room-a/admin/notification-settings'),
	loadNotificationSettings: vi.fn(),
	updateNotificationSettings: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	url: new URL('https://example.com/org-one/room-a/admin/notification-settings')
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

vi.mock('$lib/features/notification-settings', () => ({
	loadNotificationSettings: mocks.loadNotificationSettings,
	updateNotificationSettings: mocks.updateNotificationSettings
}));

vi.mock('svelte-sonner', () => ({
	toast: {
		error: mocks.toastError,
		success: mocks.toastSuccess
	}
}));

describe('通知先設定ページ', () => {
	beforeEach(() => {
		pageState.url = new URL('https://example.com/org-one/room-a/admin/notification-settings');
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadNotificationSettings.mockReset();
		mocks.updateNotificationSettings.mockReset();
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
		mocks.getCurrentPathWithSearch.mockReturnValue('/org-one/room-a/admin/notification-settings');
		mocks.loadNotificationSettings.mockResolvedValue({
			notifyOwner: true,
			notifyAdmins: true,
			notifyStoreManagers: true,
			notifyStaff: false,
			additionalEmails: ['ops@example.com']
		});
		mocks.updateNotificationSettings.mockResolvedValue({
			ok: true,
			status: 200,
			message: '通知先設定を保存しました。',
			settings: {
				notifyOwner: false,
				notifyAdmins: true,
				notifyStoreManagers: true,
				notifyStaff: true,
				additionalEmails: ['staff@example.com', 'ops@example.com']
			}
		});
	});

	it('スコープ付き通知先設定を表示して保存する', async () => {
		render(NotificationSettingsRoute);

		await expect
			.element(page.getByRole('heading', { level: 1, name: '通知先設定' }))
			.toBeInTheDocument();
		await expect.element(page.getByLabelText('組織オーナーに通知')).toBeChecked();
		await expect.element(page.getByLabelText('店舗スタッフに通知')).not.toBeChecked();
		await expect.element(page.getByLabelText('追加メールアドレス')).toHaveValue('ops@example.com');

		await page.getByLabelText('組織オーナーに通知').click();
		await page.getByLabelText('店舗スタッフに通知').click();
		await page.getByLabelText('追加メールアドレス').fill('staff@example.com\n\nops@example.com');
		await page.getByRole('button', { name: '保存' }).click();

		await vi.waitFor(() => {
			expect(mocks.updateNotificationSettings).toHaveBeenCalledWith(
				{ orgSlug: 'org-one', storeSlug: 'room-a' },
				{
					notifyOwner: false,
					notifyAdmins: true,
					notifyStoreManagers: true,
					notifyStaff: true,
					additionalEmails: ['staff@example.com', 'ops@example.com']
				}
			);
		});
		expect(mocks.toastSuccess).toHaveBeenCalledWith('通知先設定を保存しました。');
		await expect.element(page.getByText('staff@example.com')).toBeInTheDocument();
	});

	it('非スコープ管理ルートでは利用中店舗の通知先設定を取得する', async () => {
		pageState.url = new URL('https://example.com/admin/notification-settings');

		render(NotificationSettingsRoute);

		await vi.waitFor(() => {
			expect(mocks.loadNotificationSettings).toHaveBeenCalledWith({
				orgSlug: 'org-one',
				storeSlug: 'room-a'
			});
		});
	});
});
