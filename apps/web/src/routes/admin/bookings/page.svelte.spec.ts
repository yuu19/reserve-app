import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminBookingsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/org-one/room-a/admin/bookings'),
	loadAdminBookingsOperationsData: vi.fn(),
	loadOrganizationBilling: vi.fn(),
	rescheduleBookingByStaff: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	url: new URL('https://example.com/org-one/room-a/admin/bookings')
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
	redirectToLoginWithNext: mocks.redirectToLoginWithNext,
	getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
}));

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizationBilling: mocks.loadOrganizationBilling
}));

vi.mock('$lib/features/tickets.svelte', () => ({
	createTicketPurchase: vi.fn(),
	cancelTicketPurchase: vi.fn()
}));

vi.mock('$lib/features/bookings.svelte', () => ({
	approveBooking: vi.fn(),
	archiveServiceByStaff: vi.fn(),
	buildCalendarDays: vi.fn(() => []),
	cancelBooking: vi.fn(),
	cancelBookingByStaff: vi.fn(),
	cancelSlotByStaff: vi.fn(),
	createBooking: vi.fn(),
	createRecurringSchedule: vi.fn(),
	createService: vi.fn(),
	createSlot: vi.fn(),
	formatMonthLabel: vi.fn(() => '2026年6月'),
	formatTimeLabel: vi.fn(() => '11:00'),
	generateRecurringSlotsByStaff: vi.fn(),
	getMonthDateRange: vi.fn(() => ({
		fromDate: '2026-06-01',
		toDate: '2026-06-30'
	})),
	loadAdminBookingsOperationsData: mocks.loadAdminBookingsOperationsData,
	loadAdminRecurringData: vi.fn(),
	loadAdminServicesData: vi.fn(),
	loadAdminSlotsData: vi.fn(),
	loadParticipantBookingsData: vi.fn(),
	markBookingAttendance: vi.fn(),
	markBookingNoShow: vi.fn(),
	parseNumberInput: vi.fn((value: string) => Number(value) || null),
	rejectBooking: vi.fn(),
	rescheduleBookingByStaff: mocks.rescheduleBookingByStaff,
	resumeServiceByStaff: vi.fn(),
	toDateKey: vi.fn(() => '2026-06-15'),
	toDateKeyFromIso: vi.fn(() => '2026-06-15'),
	toDayBoundaryIso: vi.fn((value: string) => `${value}T00:00:00.000Z`),
	toIsoFromDateTime: vi.fn(() => '2026-06-15T01:00:00.000Z'),
	uploadServiceImage: vi.fn(),
	updateRecurringScheduleByStaff: vi.fn(),
	updateSlotByStaff: vi.fn(),
	updateServiceByStaff: vi.fn(),
	upsertRecurringExceptionByStaff: vi.fn()
}));

const createAdminBookingsOperationsData = () => ({
	activeContext: {
		orgSlug: 'org-one',
		storeSlug: 'room-a'
	},
	organizationId: 'org-1',
	canManage: true,
	premiumRestriction: null,
	services: [
		{
			id: 'service-1',
			organizationId: 'org-1',
			storeId: 'store-1',
			name: '朝ヨガ',
			description: '',
			kind: 'single',
			bookingPolicy: 'instant',
			durationMinutes: 60,
			capacity: 8,
			requiresTicket: false,
			isActive: true,
			createdAt: '2026-06-01T00:00:00.000Z',
			updatedAt: '2026-06-01T00:00:00.000Z'
		}
	],
	slots: [
		{
			id: 'slot-1',
			organizationId: 'org-1',
			storeId: 'store-1',
			serviceId: 'service-1',
			startAt: '2026-06-15T10:00:00.000Z',
			endAt: '2026-06-15T11:00:00.000Z',
			capacity: 8,
			reservedCount: 2,
			status: 'open',
			createdAt: '2026-06-01T00:00:00.000Z',
			updatedAt: '2026-06-01T00:00:00.000Z'
		},
		{
			id: 'slot-2',
			organizationId: 'org-1',
			storeId: 'store-1',
			serviceId: 'service-1',
			startAt: '2099-06-16T10:00:00.000Z',
			endAt: '2099-06-16T11:00:00.000Z',
			capacity: 8,
			reservedCount: 1,
			status: 'open',
			createdAt: '2026-06-01T00:00:00.000Z',
			updatedAt: '2026-06-01T00:00:00.000Z'
		}
	],
	staffBookings: [
		{
			id: 'booking-1',
			organizationId: 'org-1',
			storeId: 'store-1',
			slotId: 'slot-1',
			serviceId: 'service-1',
			participantId: null,
			publicId: 'bk_001',
			source: 'public_site',
			participantsCount: 2,
			customerName: '山田太郎',
			customerEmail: 'taro@example.com',
			customerPhone: '090-0000-0000',
			note: '初回体験',
			attendanceStatus: 'not_checked',
			attendanceMarkedAt: null,
			attendanceMarkedByUserId: null,
			status: 'confirmed',
			createdAt: '2026-06-01T09:00:00.000Z',
			updatedAt: '2026-06-01T09:00:00.000Z'
		}
	],
	staffParticipants: []
});

describe('管理予約ページ', () => {
	beforeEach(() => {
		pageState.url = new URL('https://example.com/org-one/room-a/admin/bookings');
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadAdminBookingsOperationsData.mockReset();
		mocks.loadOrganizationBilling.mockReset();
		mocks.rescheduleBookingByStaff.mockReset();
		mocks.getCurrentPathWithSearch.mockReturnValue('/org-one/room-a/admin/bookings');
		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' } },
			status: 200
		});
		mocks.loadAdminBookingsOperationsData.mockResolvedValue(createAdminBookingsOperationsData());
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: null
		});
		mocks.rescheduleBookingByStaff.mockResolvedValue({
			ok: true,
			message: '予約の日程を変更しました。'
		});
	});

	it('操作専用の管理予約ページを表示する', async () => {
		render(AdminBookingsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '予約管理' }))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '予約運用' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'サービス一覧' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '単発予約枠' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '定期一覧' })).toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: 'サービス管理' }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '単発予約枠管理' }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '定期Schedule管理' }))
			.not.toBeInTheDocument();
	});

	it('運営予約一覧にCSV出力と印刷用表示を出す', async () => {
		render(AdminBookingsPage);

		await expect.element(page.getByRole('button', { name: 'CSV出力' })).toBeEnabled();
		await expect.element(page.getByRole('button', { name: '印刷用表示' })).toBeEnabled();
		await expect.element(page.getByRole('cell', { name: '朝ヨガ' })).toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: '2', exact: true })).toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: '未確認' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '出席' })).toBeEnabled();
		await expect.element(page.getByRole('button', { name: '欠席' })).toBeEnabled();
		await expect.element(page.getByRole('button', { name: '日程変更' })).toBeEnabled();
	});

	it('日程変更ダイアログから変更先枠を送信する', async () => {
		render(AdminBookingsPage);

		await page.getByRole('button', { name: '日程変更' }).click();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '予約の日程を変更' }))
			.toBeInTheDocument();
		await page.getByLabelText('変更理由（任意）').fill('参加者希望');
		await page.getByRole('button', { name: '変更を保存' }).click();

		expect(mocks.rescheduleBookingByStaff).toHaveBeenCalledWith(
			'booking-1',
			'slot-2',
			'参加者希望'
		);
	});
});
