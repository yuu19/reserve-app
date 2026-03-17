import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminSlotCreatePage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/schedules/slots/new'),
	getAdminSlotsPageData: vi.fn(),
	readWindowScopedRouteContext: vi.fn(() => ({ orgSlug: 'org-1', classroomSlug: 'room-1' }))
}));

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

vi.mock('$lib/features/auth-session.svelte', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/auth-session.svelte')>(
		'$lib/features/auth-session.svelte'
	);
	return {
		...actual,
		loadSession: mocks.loadSession,
		redirectToLoginWithNext: mocks.redirectToLoginWithNext,
		getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
	};
});

vi.mock('$lib/remote/admin-slots-page.remote', () => ({
	getAdminSlotsPageData: mocks.getAdminSlotsPageData
}));

vi.mock('$lib/features/scoped-routing', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/scoped-routing')>(
		'$lib/features/scoped-routing'
	);
	return {
		...actual,
		readWindowScopedRouteContext: mocks.readWindowScopedRouteContext
	};
});

const testServices = [
	{
		id: 'service-60',
		name: '単発60分',
		description: null,
		kind: 'single',
		bookingPolicy: 'instant',
		durationMinutes: 60,
		capacity: 5,
		cancellationDeadlineMinutes: null,
		requiresTicket: false,
		isActive: true
	},
	{
		id: 'service-90',
		name: '単発90分',
		description: null,
		kind: 'single',
		bookingPolicy: 'instant',
		durationMinutes: 90,
		capacity: 5,
		cancellationDeadlineMinutes: null,
		requiresTicket: false,
		isActive: true
	}
] as const;

const selectSlotService = async (serviceName: string) => {
	await page.getByLabelText('サービス*').click();
	await expect.element(page.getByText(serviceName)).toBeInTheDocument();
	await page.getByText(serviceName).click();
};

const chooseAnyDate = async (buttonId: string, inputName: string) => {
	const triggerLabel = buttonId === 'slot-end-date' ? '終了日*' : '日付*';
	await page.getByLabelText(triggerLabel).click();

	await vi.waitFor(() => {
		const dayButton = document.querySelector(
			'[data-slot="popover-content"] [data-bits-day]'
		) as HTMLElement | null;
		expect(dayButton).toBeTruthy();
		dayButton?.click();
	});

	await vi.waitFor(() => {
		const hiddenInput = document.querySelector(`input[name="${inputName}"]`) as HTMLInputElement | null;
		expect(hiddenInput?.value ?? '').toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
};

const renderSlotCreatePage = async () => {
	render(AdminSlotCreatePage);
	await expect
		.element(page.getByRole('heading', { level: 2, name: '単発Slot作成' }))
		.toBeInTheDocument();
};

describe('/admin/schedules/slots/new/+page.svelte', () => {
	beforeEach(() => {
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.getAdminSlotsPageData.mockReset();
		mocks.readWindowScopedRouteContext.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/schedules/slots/new');
		mocks.readWindowScopedRouteContext.mockReturnValue({
			orgSlug: 'org-1',
			classroomSlug: 'room-1'
		});
		mocks.getAdminSlotsPageData.mockResolvedValue({
			activeContext: {
				orgSlug: 'org-1',
				classroomSlug: 'room-1'
			},
			canManage: true,
			services: [...testServices],
			slots: []
		});
	});

	it('should render slots create page with single back link and concrete action label', async () => {
		await renderSlotCreatePage();
		await expect
			.element(page.getByRole('heading', { level: 1, name: '単発Slot作成' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '単発一覧へ戻る' }))
			.toBeInTheDocument();
		const createSection = Array.from(document.querySelectorAll('section')).find((section) =>
			section.querySelector('h2')?.textContent?.includes('単発Slot作成')
		);
		expect(createSection).toBeTruthy();
		expect(createSection?.className ?? '').toContain('max-w-4xl');
		expect(createSection?.querySelector('form')?.className ?? '').toContain('md:grid-cols-2');

		const popoverTrigger = document.querySelector('[data-slot="popover-trigger"]');
		expect(popoverTrigger).toBeTruthy();
		expect(popoverTrigger?.className ?? '').toContain('w-full');
		const backButtons = Array.from(document.querySelectorAll('button')).filter(
			(button) => (button.textContent ?? '').trim() === '単発一覧へ戻る'
		);
		expect(backButtons).toHaveLength(1);
		await expect
			.element(page.getByRole('button', { name: '単発スロットを作成' }))
			.toBeInTheDocument();
		expect(document.body.textContent ?? '').toContain('サービスを選択してください。');
	});

	it('should disable time inputs until date is selected and hide end-date picker by default', async () => {
		await renderSlotCreatePage();

		const startTimeInput = document.getElementById('slot-start-time') as HTMLInputElement | null;
		const endTimeInput = document.getElementById('slot-end-time') as HTMLInputElement | null;
		expect(startTimeInput?.disabled).toBe(true);
		expect(endTimeInput?.disabled).toBe(true);
		expect(document.body.textContent ?? '').toContain('日付を選ぶと時刻が編集できます。');
		expect(document.getElementById('slot-end-date')).toBeNull();
	});

	it('should show end-date picker only when end-date toggle is enabled', async () => {
		await renderSlotCreatePage();

		const toggle = document.getElementById(
			'slot-use-different-end-date'
		) as HTMLInputElement | null;
		expect(toggle).toBeTruthy();
		expect(document.getElementById('slot-end-date')).toBeNull();

		toggle?.click();
		await vi.waitFor(() => {
			expect(document.getElementById('slot-end-date')).toBeTruthy();
		});
	});

	it('should show range validation error and disable submit when end is earlier than start', async () => {
		await renderSlotCreatePage();

		await selectSlotService('単発60分');
		await chooseAnyDate('slot-date', 'slot_date');

		const startTimeInput = document.getElementById('slot-start-time') as HTMLInputElement | null;
		const endTimeInput = document.getElementById('slot-end-time') as HTMLInputElement | null;
		expect(startTimeInput?.disabled).toBe(false);
		expect(endTimeInput?.disabled).toBe(false);

		startTimeInput!.value = '11:00';
		startTimeInput!.dispatchEvent(new Event('input', { bubbles: true }));
		endTimeInput!.value = '10:00';
		endTimeInput!.dispatchEvent(new Event('input', { bubbles: true }));
		endTimeInput!.dispatchEvent(new Event('blur', { bubbles: true }));

		await vi.waitFor(() => {
			expect(document.body.textContent ?? '').toContain('終了日時は開始日時より後にしてください。');
		});
		await expect
			.element(page.getByRole('button', { name: '単発スロットを作成' }))
			.toBeDisabled();
	});

	it('should auto-calculate end time from selected service duration', async () => {
		await renderSlotCreatePage();

		await selectSlotService('単発90分');
		await chooseAnyDate('slot-date', 'slot_date');

		const startTimeInput = document.getElementById('slot-start-time') as HTMLInputElement | null;
		const endTimeInput = document.getElementById('slot-end-time') as HTMLInputElement | null;
		startTimeInput!.value = '09:00';
		startTimeInput!.dispatchEvent(new Event('input', { bubbles: true }));

		await vi.waitFor(() => {
			expect(endTimeInput?.value).toBe('10:30');
		});
	});

	it('should keep manually edited end time when start time changes later', async () => {
		await renderSlotCreatePage();

		await selectSlotService('単発60分');
		await chooseAnyDate('slot-date', 'slot_date');

		const startTimeInput = document.getElementById('slot-start-time') as HTMLInputElement | null;
		const endTimeInput = document.getElementById('slot-end-time') as HTMLInputElement | null;

		startTimeInput!.value = '10:00';
		startTimeInput!.dispatchEvent(new Event('input', { bubbles: true }));
		await vi.waitFor(() => {
			expect(endTimeInput?.value).toBe('11:00');
		});

		endTimeInput!.value = '12:15';
		endTimeInput!.dispatchEvent(new Event('input', { bubbles: true }));
		startTimeInput!.value = '10:30';
		startTimeInput!.dispatchEvent(new Event('input', { bubbles: true }));

		await vi.waitFor(() => {
			expect(endTimeInput?.value).toBe('12:15');
		});
	});
});
