import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminServiceCreatePage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/services/new'),
	getAdminServicesPageData: vi.fn(),
	loadOrganizationBilling: vi.fn(),
	readWindowScopedRouteContext: vi.fn(() => ({ orgSlug: 'org-1', storeSlug: 'room-1' }))
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

vi.mock('$lib/remote/admin-services-page.remote', () => ({
	getAdminServicesPageData: mocks.getAdminServicesPageData
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

describe('サービス作成ページ', () => {
	beforeEach(() => {
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.getAdminServicesPageData.mockReset();
		mocks.loadOrganizationBilling.mockReset();
		mocks.readWindowScopedRouteContext.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/services/new');
		mocks.readWindowScopedRouteContext.mockReturnValue({
			orgSlug: 'org-1',
			storeSlug: 'room-1'
		});
		mocks.getAdminServicesPageData.mockResolvedValue({
			activeContext: {
				orgSlug: 'org-1',
				storeSlug: 'room-1'
			},
			organizationId: 'org-1',
			canManage: true,
			premiumRestriction: null,
			services: [],
			staffServices: []
		});
	});

	it('サービス作成ページを表示する', async () => {
		render(AdminServiceCreatePage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: 'サービス作成' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'サービス一覧へ戻る' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: 'サービス作成' }))
			.toBeInTheDocument();
		await expect.element(page.getByLabelText('サービス説明')).toBeInTheDocument();
		await expect.element(page.getByLabelText('キャンセル期限（分）')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '単発' })).toBeInTheDocument();
		await expect.element(page.getByLabelText(/サービス名/)).toHaveAttribute('maxlength', '120');
		await expect.element(page.getByLabelText('サービス説明')).toHaveAttribute('maxlength', '500');
		await expect.element(page.getByRole('button', { name: 'サービスを作成' })).toBeInTheDocument();
		expect(document.body.textContent ?? '').toContain('サービス名を入力してください。');
		expect(document.body.textContent ?? '').toContain('サービス名*');
		expect(document.body.textContent ?? '').toContain('所要時間（分）*');
		expect(document.body.textContent ?? '').toContain('定員*');
		const backButtons = Array.from(document.querySelectorAll('button')).filter(
			(button) => (button.textContent ?? '').trim() === 'サービス一覧へ戻る'
		);
		expect(backButtons).toHaveLength(1);

		const createSection = Array.from(document.querySelectorAll('section')).find((section) =>
			section.querySelector('h2')?.textContent?.includes('サービス作成')
		);
		expect(createSection).toBeTruthy();
		expect(createSection?.className ?? '').toContain('max-w-4xl');
		expect(createSection?.querySelector('form')?.className ?? '').toContain('md:grid-cols-2');
	});

	it('初期読み込み中は読み込みメッセージを表示し組織必須メッセージを隠す', async () => {
		mocks.getAdminServicesPageData.mockImplementation(() => new Promise(() => {}));

		render(AdminServiceCreatePage);

		await expect.element(page.getByText('予約データを読み込み中…')).toBeInTheDocument();
		await expect
			.element(page.getByText('利用中の組織を `/admin/dashboard` で選択してください。'))
			.not.toBeInTheDocument();
	});

	it('読み込み後にアクティブ組織がない場合は組織必須メッセージを表示する', async () => {
		mocks.getAdminServicesPageData.mockResolvedValue({
			activeContext: null,
			organizationId: null,
			canManage: false,
			premiumRestriction: null,
			services: [],
			staffServices: []
		});

		render(AdminServiceCreatePage);

		await expect
			.element(page.getByText('利用中の組織を `/admin/dashboard` で選択してください。'))
			.toBeInTheDocument();
	});

	it('オーナーには契約 CTA 付きでプレミアム制限案内を表示する', async () => {
		mocks.getAdminServicesPageData.mockResolvedValue({
			activeContext: {
				orgSlug: 'org-1',
				storeSlug: 'room-1'
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
			staffServices: []
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

		render(AdminServiceCreatePage);

		await expect
			.element(
				page.getByRole('heading', { level: 2, name: 'サービス運用には Premiumプランが必要です' })
			)
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '契約画面を開く' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'サービスを作成' })).toBeDisabled();
	});
});
