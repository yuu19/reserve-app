import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ReminderSettingsRoute from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/org-one/room-a/admin/reminder-settings'),
	loadReminderSettings: vi.fn(),
	updateReminderSettings: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	url: new URL('https://example.com/org-one/room-a/admin/reminder-settings')
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

vi.mock('$lib/features/reminder-settings', () => ({
	loadReminderSettings: mocks.loadReminderSettings,
	updateReminderSettings: mocks.updateReminderSettings
}));

vi.mock('svelte-sonner', () => ({
	toast: {
		error: mocks.toastError,
		success: mocks.toastSuccess
	}
}));

describe('リマインド設定ページ', () => {
	beforeEach(() => {
		pageState.url = new URL('https://example.com/org-one/room-a/admin/reminder-settings');
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadReminderSettings.mockReset();
		mocks.updateReminderSettings.mockReset();
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
		mocks.getCurrentPathWithSearch.mockReturnValue('/org-one/room-a/admin/reminder-settings');
		mocks.loadReminderSettings.mockResolvedValue({
			enabled: true,
			timingsMinutes: [1440]
		});
		mocks.updateReminderSettings.mockResolvedValue({
			ok: true,
			status: 200,
			message: 'リマインド設定を保存しました。',
			settings: {
				enabled: false,
				timingsMinutes: [180]
			}
		});
	});

	it('スコープ付きリマインド設定を表示して保存する', async () => {
		render(ReminderSettingsRoute);

		await expect
			.element(page.getByRole('heading', { level: 1, name: 'リマインド設定' }))
			.toBeInTheDocument();
		await expect.element(page.getByLabelText('リマインドメールを送信する')).toBeChecked();
		await expect.element(page.getByLabelText('開始24時間前')).toBeChecked();
		await expect.element(page.getByLabelText('開始3時間前')).not.toBeChecked();

		await page.getByLabelText('リマインドメールを送信する').click();
		await page.getByLabelText('開始24時間前').click();
		await page.getByLabelText('開始3時間前').click();
		await page.getByRole('button', { name: '保存' }).click();

		await vi.waitFor(() => {
			expect(mocks.updateReminderSettings).toHaveBeenCalledWith(
				{ orgSlug: 'org-one', storeSlug: 'room-a' },
				{
					enabled: false,
					timingsMinutes: [180]
				}
			);
		});
		expect(mocks.toastSuccess).toHaveBeenCalledWith('リマインド設定を保存しました。');
		await expect.element(page.getByText('停止中', { exact: true })).toBeInTheDocument();
	});

	it('送信タイミング未選択では保存しない', async () => {
		render(ReminderSettingsRoute);

		await expect.element(page.getByLabelText('開始24時間前')).toBeChecked();
		await page.getByLabelText('開始24時間前').click();
		await page.getByRole('button', { name: '保存' }).click();

		expect(mocks.updateReminderSettings).not.toHaveBeenCalled();
		expect(mocks.toastError).toHaveBeenCalledWith('送信タイミングを1つ以上選択してください。');
	});

	it('非スコープ管理ルートでは利用中店舗のリマインド設定を取得する', async () => {
		pageState.url = new URL('https://example.com/admin/reminder-settings');

		render(ReminderSettingsRoute);

		await vi.waitFor(() => {
			expect(mocks.loadReminderSettings).toHaveBeenCalledWith({
				orgSlug: 'org-one',
				storeSlug: 'room-a'
			});
		});
	});
});
