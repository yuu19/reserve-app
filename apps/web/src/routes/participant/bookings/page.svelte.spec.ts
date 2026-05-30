import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantBookingsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/participant/bookings'),
	loadParticipantBookingsData: vi.fn(),
	loadOrganizationBilling: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	url: new URL('http://localhost/participant/bookings')
}));

vi.mock('$app/state', () => ({
	page: pageState
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
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
	formatTimeLabel: vi.fn((value: string) => value),
	generateRecurringSlotsByStaff: vi.fn(),
	getMonthDateRange: vi.fn(() => ({
		fromDate: '2026-06-01',
		toDate: '2026-06-30'
	})),
	loadAdminBookingsOperationsData: vi.fn(),
	loadAdminRecurringData: vi.fn(),
	loadAdminServicesData: vi.fn(),
	loadAdminSlotsData: vi.fn(),
	loadParticipantBookingsData: mocks.loadParticipantBookingsData,
	markBookingNoShow: vi.fn(),
	parseNumberInput: vi.fn((value: string) => Number(value) || null),
	rejectBooking: vi.fn(),
	resumeServiceByStaff: vi.fn(),
	toDateKey: vi.fn(() => '2026-06-01'),
	toDateKeyFromIso: vi.fn(() => '2026-06-01'),
	toDayBoundaryIso: vi.fn((value: string) => `${value}T00:00:00.000Z`),
	toIsoFromDateTime: vi.fn(() => '2026-06-01T01:00:00.000Z'),
	uploadServiceImage: vi.fn(),
	updateRecurringScheduleByStaff: vi.fn(),
	updateSlotByStaff: vi.fn(),
	updateServiceByStaff: vi.fn(),
	upsertRecurringExceptionByStaff: vi.fn()
}));

const createParticipantBookingData = () => ({
	activeContext: {
		orgSlug: 'org-one',
		storeSlug: 'room-one'
	},
	organizationId: 'org-1',
	canManage: false,
	premiumRestriction: null,
	participantAccessDenied: false,
	services: [],
	slots: [],
	availableSlots: [],
	myBookings: [],
	myTicketPacks: [],
	purchasableTicketTypes: [
		{
			id: 'ticket-allowed',
			organizationId: 'org-1',
			storeId: 'room-1',
			name: 'ヨガ回数券',
			totalCount: 5,
			expiresInDays: 90,
			isActive: true,
			isForSale: true,
			serviceScope: 'all',
			serviceIds: [],
			serviceNames: [],
			createdAt: '2026-06-01T00:00:00.000Z',
			updatedAt: '2026-06-01T00:00:00.000Z'
		}
	],
	myTicketPurchases: []
});

describe('参加者予約ページ', () => {
	beforeEach(() => {
		pageState.url = new URL('http://localhost/participant/bookings');
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadParticipantBookingsData.mockReset();
		mocks.loadOrganizationBilling.mockReset();
		mocks.getCurrentPathWithSearch.mockReturnValue('/participant/bookings');
		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' } },
			status: 200
		});
		mocks.loadParticipantBookingsData.mockResolvedValue(createParticipantBookingData());
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: null
		});
	});

	it('参加者予約の見出しを表示する', async () => {
		render(ParticipantBookingsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '予約確認' }))
			.toBeInTheDocument();
	});

	it('購入可能な場合は ticketTypeId クエリを初期購入選択に使う', async () => {
		pageState.url = new URL('http://localhost/participant/bookings?ticketTypeId=ticket-allowed');

		render(ParticipantBookingsPage);

		await expect.element(page.getByLabelText('回数券種別')).toHaveValue('ticket-allowed');
	});

	it('購入不可の場合は ticketTypeId クエリを無視する', async () => {
		pageState.url = new URL('http://localhost/participant/bookings?ticketTypeId=ticket-hidden');

		render(ParticipantBookingsPage);

		await expect.element(page.getByLabelText('回数券種別')).toHaveValue('');
	});
});
