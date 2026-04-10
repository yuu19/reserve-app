import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminRecurringCreatePage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/schedules/recurring/new'),
	getAdminRecurringPageData: vi.fn(),
	loadOrganizationBilling: vi.fn(),
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

vi.mock('$lib/remote/admin-recurring-page.remote', () => ({
	getAdminRecurringPageData: mocks.getAdminRecurringPageData
}));

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizationBilling: mocks.loadOrganizationBilling
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

describe('/admin/schedules/recurring/new/+page.svelte', () => {
	beforeEach(() => {
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.getAdminRecurringPageData.mockReset();
		mocks.loadOrganizationBilling.mockReset();
		mocks.readWindowScopedRouteContext.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/schedules/recurring/new');
		mocks.readWindowScopedRouteContext.mockReturnValue({
			orgSlug: 'org-1',
			classroomSlug: 'room-1'
		});
		mocks.getAdminRecurringPageData.mockResolvedValue({
			activeContext: {
				orgSlug: 'org-1',
				classroomSlug: 'room-1'
			},
			organizationId: 'org-1',
			canManage: true,
			premiumRestriction: null,
			services: [],
			recurringSchedules: [],
			staffRecurringSchedules: []
		});
	});

	it('should render recurring create page', async () => {
		render(AdminRecurringCreatePage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '定期Schedule作成' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '定期一覧へ戻る' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '定期Schedule作成' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '定期スケジュールを作成' }))
			.toBeInTheDocument();
		expect(document.body.textContent ?? '').toContain('サービスを選択してください。');
		expect(document.body.textContent ?? '').toContain('サービス*');
		expect(document.body.textContent ?? '').toContain('間隔*');
		expect(document.body.textContent ?? '').toContain('開始時刻*');
		const backButtons = Array.from(document.querySelectorAll('button')).filter(
			(button) => (button.textContent ?? '').trim() === '定期一覧へ戻る'
		);
		expect(backButtons).toHaveLength(1);

		const createSection = Array.from(document.querySelectorAll('section')).find((section) =>
			section.querySelector('h2')?.textContent?.includes('定期Schedule作成')
		);
		expect(createSection).toBeTruthy();
		expect(createSection?.className ?? '').toContain('max-w-4xl');
		expect(createSection?.querySelector('form')?.className ?? '').toContain('md:grid-cols-2');
	});

	it('shows premium restriction guidance on recurring create page', async () => {
		mocks.getAdminRecurringPageData.mockResolvedValue({
			activeContext: {
				orgSlug: 'org-1',
				classroomSlug: 'room-1'
			},
			organizationId: 'org-1',
			canManage: true,
			premiumRestriction: {
				message: 'Organization premium plan is required for this feature.',
				code: 'organization_premium_required',
				source: 'application_billing_state',
				reason: 'organization_plan_is_free',
				entitlementState: 'free_only',
				planState: 'free',
				trialEndsAt: null
			},
			services: [],
			recurringSchedules: [],
			staffRecurringSchedules: []
		});
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'free',
				planState: 'free',
				billingInterval: null,
				paymentMethodStatus: 'not_started',
				subscriptionStatus: 'free',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: null,
				trialEndsAt: null,
				canViewBilling: true,
				canManageBilling: true
			}
		});

		render(AdminRecurringCreatePage);

		await expect
			.element(page.getByText('定期スケジュール運用には Premiumプランが必要です'))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '定期スケジュールを作成' }))
			.toBeDisabled();
	});
});
