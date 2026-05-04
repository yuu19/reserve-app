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

const createBillingFixture = (overrides: Record<string, unknown> = {}) => ({
	planCode: 'free',
	planState: 'free',
	billingInterval: null,
	subscriptionStatus: 'free',
	cancelAtPeriodEnd: false,
	currentPeriodEnd: null,
	trialEndsAt: null,
	pastDueGraceEndsAt: null,
	paymentMethodStatus: 'not_started',
	paidTier: null,
	canViewBilling: true,
	canManageBilling: true,
	actionAvailability: {
		canStartTrial: true,
		canStartPaidCheckout: false,
		canRegisterPaymentMethod: false,
		canOpenBillingPortal: false,
		trialUsed: false,
		availableIntervals: [],
		nextOwnerAction: 'start_trial',
		readOnlyReason: null
	},
	billingProfileReadiness: {
		state: 'not_required',
		nextAction: null,
		checkedAt: null,
		gatesCheckout: false,
		gatesPremiumEligibility: false
	},
	history: [],
	paymentDocuments: {
		aggregateRoot: 'organization_billing',
		organizationId: 'org-1',
		provider: 'stripe',
		stripeCustomerId: null,
		stripeSubscriptionId: null,
		ownerAccess: 'owner_only',
		persistenceStrategy: 'provider_reference_only',
		documents: []
	},
	invoicePaymentEvents: [],
	...overrides
});

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
			billing: createBillingFixture()
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
			.element(
				page.getByText(
					'この操作ではまだ支払い方法は登録されません。継続設定は次のステップで案内されます。'
				)
			)
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
		await expect
			.element(page.getByRole('button', { name: '支払い方法を登録' }))
			.toBeInTheDocument();
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
						billingContext:
							'契約状態: Premiumトライアル / ステータス: トライアル中 / 支払い方法: 未登録',
						tone: 'neutral'
					}
				]
			}
		});

		render(ContractsPage);

		await expect
			.element(page.getByRole('heading', { level: 2, name: '契約履歴' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('契約状態の同期を確認しました')).toBeInTheDocument();
		await expect
			.element(page.getByText('トライアル終了前のお知らせを送信しました'))
			.toBeInTheDocument();
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

		await expect
			.element(page.getByRole('button', { name: 'プランを変更' }))
			.not.toBeInTheDocument();
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
			.element(
				page.getByText('Premium の申込処理を開始しました。反映まで数秒かかる場合があります。')
			)
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
		await expect.element(page.getByText('登録完了を自動確認しています。')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '最新状態を確認' })).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '支払い方法を登録' }))
			.toBeInTheDocument();
	});

	it('should let owners manually refresh pending payment method registration status', async () => {
		mocks.pageState.url = new URL('https://example.com/admin/contracts?paymentMethod=success');
		mocks.loadOrganizationBilling
			.mockResolvedValueOnce({
				ok: true,
				billing: createBillingFixture({
					planCode: 'premium',
					planState: 'premium_trial',
					subscriptionStatus: 'trialing',
					currentPeriodEnd: '2026-04-15T00:00:00.000Z',
					trialEndsAt: '2026-04-15T00:00:00.000Z',
					paymentMethodStatus: 'pending'
				})
			})
			.mockResolvedValueOnce({
				ok: true,
				billing: createBillingFixture({
					planCode: 'premium',
					planState: 'premium_trial',
					subscriptionStatus: 'trialing',
					currentPeriodEnd: '2026-04-15T00:00:00.000Z',
					trialEndsAt: '2026-04-15T00:00:00.000Z',
					paymentMethodStatus: 'registered'
				})
			});

		render(ContractsPage);

		await expect.element(page.getByText(/^登録手続き中$/)).toBeInTheDocument();
		await page.getByRole('button', { name: '最新状態を確認' }).click();

		await expect.element(page.getByText(/^登録済み$/)).toBeInTheDocument();
		await expect.element(page.getByRole('status')).toBeInTheDocument();
		expect(mocks.loadOrganizationBilling).toHaveBeenCalledTimes(2);
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

		await expect.element(page.getByRole('status')).toBeInTheDocument();
		await expect.element(page.getByText(/^登録済み$/)).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '支払い方法を登録' }))
			.not.toBeInTheDocument();
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
		await expect
			.element(page.getByRole('button', { name: '支払い方法を登録' }))
			.not.toBeInTheDocument();
	});

	it('renders owner payment issue states with portal recovery action', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createBillingFixture({
				planCode: 'premium',
				planState: 'premium_paid',
				billingInterval: 'month',
				subscriptionStatus: 'past_due',
				pastDueGraceEndsAt: '2026-04-18T00:00:00.000Z',
				paymentMethodStatus: 'registered',
				canManageBilling: true,
				actionAvailability: {
					canStartTrial: false,
					canStartPaidCheckout: false,
					canRegisterPaymentMethod: false,
					canOpenBillingPortal: true,
					trialUsed: true,
					availableIntervals: ['month', 'year'],
					nextOwnerAction: 'open_billing_portal',
					readOnlyReason: null
				}
			})
		});

		render(ContractsPage);

		await expect
			.element(page.getByText(/支払い遅延の猶予期間中です。猶予期限は/))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'プランを変更' })).toBeInTheDocument();
	});

	it('renders non-owner payment issue states without owner controls', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createBillingFixture({
				planCode: 'premium',
				planState: 'premium_paid',
				billingInterval: 'month',
				subscriptionStatus: 'unpaid',
				paymentMethodStatus: 'registered',
				canManageBilling: false,
				history: null,
				paymentDocuments: null,
				invoicePaymentEvents: [],
				actionAvailability: {
					canStartTrial: false,
					canStartPaidCheckout: false,
					canRegisterPaymentMethod: false,
					canOpenBillingPortal: false,
					trialUsed: true,
					availableIntervals: ['month', 'year'],
					nextOwnerAction: 'billing_management_requires_organization_owner',
					readOnlyReason: 'billing_management_requires_organization_owner'
				}
			})
		});

		render(ContractsPage);

		await expect
			.element(page.getByText(/未払い状態のため Premium 機能は停止されています/))
			.toBeInTheDocument();
		await expect
			.element(
				page.getByText(
					'あなたの role では契約状態の閲覧のみ可能です。教室や参加者の運用権限があっても、billing authority は付与されません。'
				)
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'プランを変更' }))
			.not.toBeInTheDocument();
	});

	it('renders trial-used free checkout choices and hides duplicate trial entry', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createBillingFixture({
				actionAvailability: {
					canStartTrial: false,
					canStartPaidCheckout: true,
					canRegisterPaymentMethod: false,
					canOpenBillingPortal: false,
					trialUsed: true,
					availableIntervals: ['month', 'year'],
					nextOwnerAction: 'start_paid_checkout',
					readOnlyReason: null
				}
			})
		});

		render(ContractsPage);

		await expect
			.element(
				page.getByText('この組織ではトライアルを利用済みです。必要に応じて有料契約へ進めます。')
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '7日間のPremiumトライアルを開始' }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '月額Premiumを開始' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '年額Premiumを開始' }))
			.toBeInTheDocument();
	});

	it('renders owner-only payment documents and invoice events', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createBillingFixture({
				planCode: 'premium',
				planState: 'premium_paid',
				billingInterval: 'year',
				subscriptionStatus: 'active',
				paymentMethodStatus: 'registered',
				actionAvailability: {
					canStartTrial: false,
					canStartPaidCheckout: false,
					canRegisterPaymentMethod: false,
					canOpenBillingPortal: true,
					trialUsed: true,
					availableIntervals: ['month', 'year'],
					nextOwnerAction: 'open_billing_portal',
					readOnlyReason: null
				},
				paymentDocuments: {
					aggregateRoot: 'organization_billing',
					organizationId: 'org-1',
					provider: 'stripe',
					stripeCustomerId: 'cus_docs',
					stripeSubscriptionId: 'sub_docs',
					ownerAccess: 'owner_only',
					persistenceStrategy: 'provider_reference_only',
					documents: [
						{
							documentKind: 'invoice',
							providerDocumentId: 'in_docs',
							hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_docs',
							invoicePdfUrl: null,
							receiptUrl: null,
							availability: 'available',
							ownerFacingStatus: 'available'
						},
						{
							documentKind: 'receipt',
							providerDocumentId: 'ch_docs',
							hostedInvoiceUrl: null,
							invoicePdfUrl: null,
							receiptUrl: 'https://pay.stripe.com/receipts/ch_docs',
							availability: 'available',
							ownerFacingStatus: 'available'
						},
						{
							documentKind: 'invoice',
							providerDocumentId: 'in_checking',
							hostedInvoiceUrl: null,
							invoicePdfUrl: null,
							receiptUrl: null,
							availability: 'checking',
							ownerFacingStatus: 'checking'
						}
					]
				},
				invoicePaymentEvents: [
					{
						id: 'event-1',
						eventType: 'payment_failed',
						stripeEventId: 'evt_failed',
						stripeInvoiceId: 'in_docs',
						stripePaymentIntentId: 'pi_docs',
						providerStatus: 'open',
						ownerFacingStatus: 'failed',
						occurredAt: '2026-04-18T00:00:00.000Z',
						createdAt: '2026-04-18T00:00:00.000Z'
					}
				]
			})
		});

		render(ContractsPage);

		await expect
			.element(page.getByRole('heading', { name: '請求書・支払いイベント' }))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '請求書を開く' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '領収書を開く' })).toBeInTheDocument();
		await expect.element(page.getByText('請求書: checking')).toBeInTheDocument();
		await expect.element(page.getByText('payment_failed')).toBeInTheDocument();
	});

	it('hides payment documents and invoice events for non-owners', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createBillingFixture({
				planCode: 'premium',
				planState: 'premium_paid',
				billingInterval: 'year',
				subscriptionStatus: 'active',
				paymentMethodStatus: 'registered',
				canManageBilling: false,
				history: null,
				paymentDocuments: null,
				invoicePaymentEvents: []
			})
		});

		render(ContractsPage);

		await expect
			.element(page.getByRole('heading', { name: '請求書・支払いイベント' }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '請求書を開く' }))
			.not.toBeInTheDocument();
		await expect.element(page.getByText('payment_failed')).not.toBeInTheDocument();
	});

	it('renders unknown price and billing profile readiness guidance safely', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createBillingFixture({
				planCode: 'premium',
				planState: 'premium_paid',
				billingInterval: 'month',
				subscriptionStatus: 'active',
				paymentMethodStatus: 'registered',
				paidTier: {
					code: 'premium_unknown',
					label: 'Premium',
					resolution: 'unknown_price',
					diagnosticReason: 'stripe_price_id_not_in_paid_tier_catalog',
					capabilities: []
				},
				billingProfileReadiness: {
					state: 'incomplete',
					nextAction: '請求先情報は Stripe Checkout で確認してください。',
					checkedAt: '2026-04-18T00:00:00.000Z',
					gatesCheckout: false,
					gatesPremiumEligibility: false
				}
			})
		});

		render(ContractsPage);

		await expect
			.element(
				page.getByText(
					'未登録の Stripe price id を検出したため Premium 機能を停止しています。サポート確認が必要です。'
				)
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByText('請求先情報は Stripe Checkout で確認してください。'))
			.toBeInTheDocument();
		await expect
			.element(page.getByText(/stripe_price_id_not_in_paid_tier_catalog/))
			.not.toBeInTheDocument();
	});
});
