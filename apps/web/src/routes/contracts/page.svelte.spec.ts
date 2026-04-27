import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ContractsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	pageState: {
		url: new URL('https://example.com/admin/contracts')
	},
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/contracts'),
	loadOrganizations: vi.fn(),
	loadOrganizationBilling: vi.fn(),
	createOrganizationBillingTrial: vi.fn(),
	createOrganizationBillingPaymentMethod: vi.fn(),
	createOrganizationBillingCheckout: vi.fn(),
	createOrganizationBillingPortal: vi.fn()
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$app/state', () => ({
	page: mocks.pageState
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession,
	loadPortalAccess: mocks.loadPortalAccess,
	resolvePortalHomePath: mocks.resolvePortalHomePath,
	redirectToLoginWithNext: mocks.redirectToLoginWithNext,
	getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
}));

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizations: mocks.loadOrganizations,
	loadOrganizationBilling: mocks.loadOrganizationBilling,
	createOrganizationBillingTrial: mocks.createOrganizationBillingTrial,
	createOrganizationBillingPaymentMethod: mocks.createOrganizationBillingPaymentMethod,
	createOrganizationBillingCheckout: mocks.createOrganizationBillingCheckout,
	createOrganizationBillingPortal: mocks.createOrganizationBillingPortal
}));

describe('/contracts/+page.svelte', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.pageState.url = new URL('https://example.com/admin/contracts');
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadOrganizations.mockReset();
		mocks.loadOrganizationBilling.mockReset();
		mocks.createOrganizationBillingTrial.mockReset();
		mocks.createOrganizationBillingPaymentMethod.mockReset();
		mocks.createOrganizationBillingCheckout.mockReset();
		mocks.createOrganizationBillingPortal.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: true
		});
		mocks.resolvePortalHomePath.mockReturnValue('/admin/dashboard');
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/contracts');
		mocks.loadOrganizations.mockResolvedValue({
			activeOrganization: {
				id: 'org-1',
				name: 'Org One',
				slug: 'org-one'
			}
		});
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'free',
				planState: 'free',
				billingInterval: null,
				subscriptionStatus: 'free',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: null,
				trialEndsAt: null,
				paymentMethodStatus: 'not_started',
				canViewBilling: true,
				canManageBilling: true
			}
		});
		mocks.createOrganizationBillingTrial.mockResolvedValue({
			ok: true,
			status: 200,
			message: '7日間のPremiumトライアルを開始しました。'
		});
		mocks.createOrganizationBillingPaymentMethod.mockResolvedValue({
			ok: true,
			status: 200,
			url: 'https://checkout.stripe.com/c/pay/cs_test_payment_method_setup',
			message: ''
		});
		mocks.createOrganizationBillingPortal.mockResolvedValue({
			ok: true,
			status: 200,
			url: 'https://billing.stripe.com/p/session/test_portal',
			message: ''
		});
	});

	it('should render free plan summary and premium comparison for owners', async () => {
		render(ContractsPage);
		await expect.element(page.getByRole('heading', { level: 1, name: '契約' })).toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '現在プラン' }))
			.toBeInTheDocument();
		await expect.element(page.getByText(/^無料プラン$/)).toBeInTheDocument();
		await expect.element(page.getByText('無料で使える機能')).toBeInTheDocument();
		await expect.element(page.getByText('Premiumで使える機能')).toBeInTheDocument();
		await expect
			.element(
				page.getByText(
					'7日間のPremiumトライアルでは、複数教室管理、スタッフ権限、定期スケジュールなどのPremium機能をまとめて確認できます。'
				)
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByText('この操作ではまだ支払い方法は登録されません。継続設定は次のステップで案内されます。'))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '7日間のPremiumトライアルを開始' }))
			.toBeInTheDocument();
	});

	it('should display the primary billing state within the 3-second success criterion', async () => {
		const startedAt = performance.now();

		render(ContractsPage);

		await expect.element(page.getByText(/^無料プラン$/)).toBeInTheDocument();
		expect(performance.now() - startedAt).toBeLessThan(3_000);
	});

	it('redirects non org-admin users away from contracts', async () => {
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: false
		});
		mocks.resolvePortalHomePath.mockReturnValue('/participant/home');

		render(ContractsPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/participant/home');
		});
	});

	it('should render plan change action for premium plan owners', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'premium',
				planState: 'premium_paid',
				paidTier: {
					code: 'premium_default',
					label: 'Premium',
					resolution: 'legacy_default',
					capabilities: ['organization_premium_features']
				},
				billingInterval: 'month',
				subscriptionStatus: 'active',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: '2026-04-01T00:00:00.000Z',
				trialEndsAt: null,
				paymentMethodStatus: 'registered',
				canViewBilling: true,
				canManageBilling: true
			}
		});

		render(ContractsPage);

		await expect.element(page.getByRole('button', { name: 'プランを変更' })).toBeInTheDocument();
		await expect.element(page.getByText('契約ティア: Premium')).toBeInTheDocument();
		await expect
			.element(
				page.getByText(
					'現在はPremiumプラン利用中です。プラン変更は Stripe の契約管理画面で進め、反映後の状態はこの画面で確認できます。'
				)
			)
			.toBeInTheDocument();
	});

	it('should render trial end guidance for premium trial state', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'premium',
				planState: 'premium_trial',
				billingInterval: 'month',
				subscriptionStatus: 'trialing',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: '2026-04-11T00:00:00.000Z',
				trialEndsAt: '2026-04-11T00:00:00.000Z',
				paymentMethodStatus: 'not_started',
				canViewBilling: true,
				canManageBilling: true
			}
		});

		render(ContractsPage);

		await expect.element(page.getByText('プレミアムトライアル')).toBeInTheDocument();
		await expect.element(page.getByText(/トライアル終了日/)).toBeInTheDocument();
		await expect
			.element(
				page.getByText(
					'現在はPremiumトライアル中です。終了日まで Premium 機能を確認でき、新しいトライアルを重ねて開始することはできません。'
				)
			)
			.toBeInTheDocument();
		await expect.element(page.getByText(/^支払い方法の登録状況$/)).toBeInTheDocument();
		await expect.element(page.getByText(/^未登録$/)).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '支払い方法を登録' })).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '7日間のPremiumトライアルを開始' }))
			.not.toBeInTheDocument();
	});

	it('renders owner billing history entries when history is available', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'premium',
				planState: 'premium_paid',
				billingInterval: 'month',
				subscriptionStatus: 'active',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: '2026-05-01T00:00:00.000Z',
				trialEndsAt: null,
				paymentMethodStatus: 'registered',
				canViewBilling: true,
				canManageBilling: true,
				history: [
					{
						id: 'history-1',
						eventType: 'reconciliation',
						occurredAt: '2026-04-20T03:00:00.000Z',
						title: '契約状態の同期を確認しました',
						summary: 'アプリ内の契約状態と決済サービスの状態が一致していることを確認しました。',
						billingContext: '契約状態: Premiumプラン / ステータス: 有効 / 支払い方法: 登録済み',
						tone: 'positive'
					},
					{
						id: 'history-2',
						eventType: 'notification',
						occurredAt: '2026-04-18T03:00:00.000Z',
						title: 'トライアル終了前のお知らせを送信しました',
						summary: '契約内容の確認案内を送信しました。',
						billingContext: '契約状態: Premiumトライアル / ステータス: トライアル中 / 支払い方法: 未登録',
						tone: 'neutral'
					}
				]
			}
		});

		render(ContractsPage);

		await expect.element(page.getByRole('heading', { level: 2, name: '契約履歴' })).toBeInTheDocument();
		await expect.element(page.getByText('契約状態の同期を確認しました')).toBeInTheDocument();
		await expect.element(page.getByText('トライアル終了前のお知らせを送信しました')).toBeInTheDocument();
		await expect
			.element(page.getByText('契約状態: Premiumプラン / ステータス: 有効 / 支払い方法: 登録済み'))
			.toBeInTheDocument();
	});

	it('starts a premium trial for free-plan owners and refreshes the summary', async () => {
		mocks.loadOrganizationBilling.mockResolvedValueOnce({
			ok: true,
			billing: {
				planCode: 'free',
				planState: 'free',
				billingInterval: null,
				subscriptionStatus: 'free',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: null,
				trialEndsAt: null,
				paymentMethodStatus: 'not_started',
				canViewBilling: true,
				canManageBilling: true
			}
		});
		mocks.loadOrganizationBilling.mockResolvedValueOnce({
			ok: true,
			billing: {
				planCode: 'premium',
				planState: 'premium_trial',
				billingInterval: null,
				subscriptionStatus: 'trialing',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: '2026-04-15T00:00:00.000Z',
				trialEndsAt: '2026-04-15T00:00:00.000Z',
				paymentMethodStatus: 'not_started',
				canViewBilling: true,
				canManageBilling: true
			}
		});

		render(ContractsPage);

		await page.getByRole('button', { name: '7日間のPremiumトライアルを開始' }).click();

		await vi.waitFor(() => {
			expect(mocks.createOrganizationBillingTrial).toHaveBeenCalledWith({
				organizationId: 'org-1'
			});
		});
		await expect
			.element(page.getByText(/7日間のPremiumトライアルを開始しました。終了日は/))
			.toBeInTheDocument();
		await expect.element(page.getByText('プレミアムトライアル')).toBeInTheDocument();
	});

	it('should hide owner-only billing controls for read-only admins', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'free',
				planState: 'free',
				billingInterval: null,
				subscriptionStatus: 'free',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: null,
				trialEndsAt: null,
				paymentMethodStatus: 'not_started',
				canViewBilling: true,
				canManageBilling: false
			}
		});

		render(ContractsPage);

		await expect
			.element(
				page.getByText(
					'あなたの role では契約状態の閲覧のみ可能です。教室や参加者の運用権限があっても、billing authority は付与されません。'
				)
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '7日間のPremiumトライアルを開始' }))
			.not.toBeInTheDocument();
		await expect
			.element(
				page.getByText(
					'契約履歴の詳細は organization owner のみ確認できます。必要な場合は owner に確認を依頼してください。'
				)
			)
			.toBeInTheDocument();
	});

	it('should explain paid lifecycle without showing duplicate trial entry', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'premium',
				planState: 'premium_paid',
				billingInterval: 'month',
				subscriptionStatus: 'active',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: '2026-05-01T00:00:00.000Z',
				trialEndsAt: null,
				paymentMethodStatus: 'registered',
				canViewBilling: true,
				canManageBilling: true
			}
		});

		render(ContractsPage);

		await expect
			.element(
				page.getByText(
					'現在はPremiumプラン利用中です。プラン変更は Stripe の契約管理画面で進め、反映後の状態はこの画面で確認できます。'
				)
			)
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'プランを変更' })).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '7日間のPremiumトライアルを開始' }))
			.not.toBeInTheDocument();
	});

	it('should hide plan change action for read-only premium users', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'premium',
				planState: 'premium_paid',
				paidTier: {
					code: 'premium_unknown',
					label: 'Premium',
					resolution: 'unknown_price',
					diagnosticReason: 'stripe_price_id_not_in_paid_tier_catalog',
					capabilities: ['organization_premium_features']
				},
				billingInterval: 'year',
				subscriptionStatus: 'active',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: '2026-05-01T00:00:00.000Z',
				trialEndsAt: null,
				paymentMethodStatus: 'registered',
				canViewBilling: true,
				canManageBilling: false
			}
		});

		render(ContractsPage);

		await expect.element(page.getByRole('button', { name: 'プランを変更' })).not.toBeInTheDocument();
		await expect.element(page.getByText('契約ティア: Premium')).toBeInTheDocument();
		await expect
			.element(
				page.getByText(
					'契約状態は確認できますが、契約変更と支払い設定は organization owner のみが扱います。'
				)
			)
			.toBeInTheDocument();
	});

	it('should show text-based loading and intermediate status messaging', async () => {
		mocks.pageState.url = new URL('https://example.com/admin/contracts?subscription=success');
		mocks.loadOrganizations.mockImplementation(
			() => new Promise(() => undefined) as ReturnType<typeof mocks.loadOrganizations>
		);

		render(ContractsPage);

		await expect.element(page.getByText('契約情報を確認しています…')).toBeInTheDocument();
		await expect
			.element(page.getByText('Premium の申込処理を開始しました。反映まで数秒かかる場合があります。'))
			.toBeInTheDocument();
	});

	it('should keep payment method return messaging intermediate until billing summary confirms registration', async () => {
		mocks.pageState.url = new URL('https://example.com/admin/contracts?paymentMethod=success');
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'premium',
				planState: 'premium_trial',
				billingInterval: null,
				subscriptionStatus: 'trialing',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: '2026-04-15T00:00:00.000Z',
				trialEndsAt: '2026-04-15T00:00:00.000Z',
				paymentMethodStatus: 'pending',
				canViewBilling: true,
				canManageBilling: true
			}
		});

		render(ContractsPage);

		await expect
			.element(
				page.getByText('支払い方法の更新状況を確認しています。反映まで数秒かかる場合があります。')
			)
			.toBeInTheDocument();
		await expect.element(page.getByText(/^登録手続き中$/)).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '支払い方法を登録' })).toBeInTheDocument();
	});

	it('should show registered payment method status without owner action once confirmed', async () => {
		mocks.pageState.url = new URL('https://example.com/admin/contracts?paymentMethod=success');
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'premium',
				planState: 'premium_trial',
				billingInterval: null,
				subscriptionStatus: 'trialing',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: '2026-04-15T00:00:00.000Z',
				trialEndsAt: '2026-04-15T00:00:00.000Z',
				paymentMethodStatus: 'registered',
				canViewBilling: true,
				canManageBilling: true
			}
		});

		render(ContractsPage);

		await expect
			.element(page.getByRole('status'))
			.toBeInTheDocument();
		await expect.element(page.getByText(/^登録済み$/)).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '支払い方法を登録' })).not.toBeInTheDocument();
	});

	it('should show payment method status to read-only admins without exposing owner action', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'premium',
				planState: 'premium_trial',
				billingInterval: null,
				subscriptionStatus: 'trialing',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: '2026-04-15T00:00:00.000Z',
				trialEndsAt: '2026-04-15T00:00:00.000Z',
				paymentMethodStatus: 'pending',
				canViewBilling: true,
				canManageBilling: false
			}
		});

		render(ContractsPage);

		await expect.element(page.getByText(/^支払い方法の登録状況$/)).toBeInTheDocument();
		await expect.element(page.getByText(/^登録手続き中$/)).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '支払い方法を登録' })).not.toBeInTheDocument();
	});
});
