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
	paymentIssueStartedAt: null,
	pastDueGraceEndsAt: null,
	paymentIssueState: 'none',
	paymentIssueTiming: {
		issueStartedAt: null,
		issueStartedAtSource: 'none',
		graceEndsAt: null
	},
	nextOwnerAction: 'start_trial',
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
		aggregateRoot: 'billing_account',
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

const createPaymentIssueBillingFixture = (overrides: Record<string, unknown> = {}) =>
	createBillingFixture({
		planCode: 'premium',
		planState: 'premium_paid',
		paidTier: {
			code: 'premium_default',
			label: 'Premium',
			resolution: 'legacy_default',
			capabilities: ['organization_premium_features']
		},
		billingInterval: 'month',
		subscriptionStatus: 'past_due',
		currentPeriodEnd: '2026-06-01T00:00:00.000Z',
		paymentIssueStartedAt: '2026-05-01T00:00:00.000Z',
		pastDueGraceEndsAt: '2026-05-08T00:00:00.000Z',
		paymentIssueState: 'past_due_grace_active',
		paymentIssueTiming: {
			issueStartedAt: '2026-05-01T00:00:00.000Z',
			issueStartedAtSource: 'provider_issue_time',
			graceEndsAt: '2026-05-08T00:00:00.000Z'
		},
		nextOwnerAction: 'update_payment_method',
		paymentMethodStatus: 'registered',
		actionAvailability: {
			canStartTrial: false,
			canStartPaidCheckout: false,
			canRegisterPaymentMethod: true,
			canOpenBillingPortal: true,
			trialUsed: true,
			availableIntervals: ['month', 'year'],
			nextOwnerAction: 'update_payment_method',
			readOnlyReason: null
		},
		invoicePaymentEvents: [
			{
				id: 'invoice-event-payment-failed',
				eventType: 'payment_failed',
				stripeEventId: 'evt_payment_failed',
				ownerFacingStatus: 'failed',
				occurredAt: '2026-05-01T00:00:00.000Z'
			}
		],
		history: [
			{
				id: 'history-payment-failed',
				eventType: 'payment_issue',
				occurredAt: '2026-05-01T00:00:00.000Z',
				title: '支払いを完了できませんでした',
				summary: '契約ページから支払い方法または請求状況を確認してください。',
				billingContext: '契約状態: Premiumプラン / ステータス: 支払い遅延 / 支払い方法: 登録済み',
				tone: 'warning'
			}
		],
		...overrides
	});

describe('契約ページ', () => {
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

	it('オーナー向けに無料プラン概要とプレミアム比較を表示する', async () => {
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
					'7日間のPremiumトライアルでは、複数店舗管理、スタッフ権限、定期スケジュールなどのPremium機能をまとめて確認できます。'
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

	it('3 秒以内の成功基準で主要な課金状態を表示する', async () => {
		const startedAt = performance.now();

		render(ContractsPage);

		await expect.element(page.getByText(/^無料プラン$/)).toBeInTheDocument();
		expect(performance.now() - startedAt).toBeLessThan(3_000);
	});

	it('org-admin 以外のユーザーを契約ページからリダイレクトする', async () => {
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: false
		});
		mocks.resolvePortalHomePath.mockReturnValue('/participant/home');

		render(ContractsPage);

		await vi.waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/participant/home');
		});
	});

	it('プレミアムプランのオーナーにプラン変更アクションを表示する', async () => {
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

	it('プレミアムトライアル状態ではトライアル終了案内を表示する', async () => {
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

	it('履歴がある場合はオーナー向け課金履歴項目を表示する', async () => {
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

	it('無料プランのオーナーがプレミアムトライアルを開始しサマリーを更新する', async () => {
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

	it('読み取り専用管理者にはオーナー限定の課金操作を隠す', async () => {
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
					'あなたの role では契約状態の閲覧のみ可能です。店舗や参加者の運用権限があっても、billing authority は付与されません。'
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

	it('重複するトライアル導線を表示せず有料ライフサイクルを説明する', async () => {
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

	it('読み取り専用プレミアムユーザーにはプラン変更アクションを隠す', async () => {
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

	it('テキストベースの読み込み表示と中間ステータスメッセージを表示する', async () => {
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

	it('課金サマリーが登録を確認するまで支払い方法戻りメッセージを中間状態に保つ', async () => {
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

	it('オーナーが保留中の支払い方法登録状態を手動更新できるようにする', async () => {
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

	it('確認後はオーナー操作なしで登録済み支払い方法状態を表示する', async () => {
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

	it('failed 状態のオーナー向け支払い問題案内を表示する', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createPaymentIssueBillingFixture({
				subscriptionStatus: 'active',
				paymentIssueState: 'payment_failed',
				pastDueGraceEndsAt: null,
				paymentIssueTiming: {
					issueStartedAt: '2026-05-01T00:00:00.000Z',
					issueStartedAtSource: 'provider_issue_time',
					graceEndsAt: null
				},
				history: []
			})
		});

		render(ContractsPage);

		await expect.element(page.getByText('支払いを完了できませんでした')).toBeInTheDocument();
		await expect
			.element(page.getByText('契約ページから支払い方法または請求状況を確認してください。'))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'プランを変更' })).toBeInTheDocument();
	});

	it('action-required 状態のオーナー向け支払い問題案内を表示する', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createPaymentIssueBillingFixture({
				subscriptionStatus: 'active',
				paymentIssueState: 'payment_action_required',
				history: []
			})
		});

		render(ContractsPage);

		await expect.element(page.getByText('支払い方法の認証が必要です')).toBeInTheDocument();
	});

	it('past-due 猶予の支払い問題状態を表示する', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createPaymentIssueBillingFixture()
		});

		render(ContractsPage);

		await expect.element(page.getByText(/支払い遅延の猶予期間中です/)).toBeInTheDocument();
		await expect.element(page.getByText(/猶予期限/)).toBeInTheDocument();
	});

	it('期限切れ past-due 猶予の支払い問題状態を表示する', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createPaymentIssueBillingFixture({
				paymentIssueState: 'past_due_grace_expired',
				pastDueGraceEndsAt: '2026-05-01T00:00:00.000Z',
				paymentIssueTiming: {
					issueStartedAt: '2026-04-24T00:00:00.000Z',
					issueStartedAtSource: 'provider_issue_time',
					graceEndsAt: '2026-05-01T00:00:00.000Z'
				}
			})
		});
		render(ContractsPage);
		await expect.element(page.getByText('支払い遅延の猶予期限を過ぎています')).toBeInTheDocument();
	});

	it('unpaid の支払い問題状態を表示する', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createPaymentIssueBillingFixture({
				subscriptionStatus: 'unpaid',
				paymentIssueState: 'unpaid'
			})
		});
		render(ContractsPage);
		await expect.element(page.getByText(/未払い状態のため Premium 機能は停止/)).toBeInTheDocument();
	});

	it('incomplete の支払い問題状態を表示する', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createPaymentIssueBillingFixture({
				subscriptionStatus: 'incomplete',
				paymentIssueState: 'incomplete'
			})
		});
		render(ContractsPage);
		await expect.element(page.getByText(/契約処理が未完了/)).toBeInTheDocument();
	});

	it('復旧済みの支払い問題状態を表示する', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createPaymentIssueBillingFixture({
				subscriptionStatus: 'active',
				paymentIssueState: 'recovered',
				history: []
			})
		});
		render(ContractsPage);
		await expect.element(page.getByText('支払い問題は解消済みです')).toBeInTheDocument();
	});

	it('履歴のみの古い支払い問題状態を表示する', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createPaymentIssueBillingFixture({
				subscriptionStatus: 'active',
				paymentIssueState: 'stale_failure_history_only'
			})
		});
		render(ContractsPage);
		await expect
			.element(page.getByText('古い支払い失敗通知を履歴として保持しています'))
			.toBeInTheDocument();
		await expect.element(page.getByText('支払いを完了できませんでした')).toBeInTheDocument();
	});

	it('読み取り専用管理者にオーナー操作を公開せず支払い方法状態を表示する', async () => {
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

	it('ポータル復旧アクション付きでオーナー向け支払い問題状態を表示する', async () => {
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

	it('非オーナーにはオーナー操作なしで支払い問題状態を表示する', async () => {
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
					'あなたの role では契約状態の閲覧のみ可能です。店舗や参加者の運用権限があっても、billing authority は付与されません。'
				)
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'プランを変更' }))
			.not.toBeInTheDocument();
	});

	it('契約ページで支払い問題通知の受信者詳細を公開しない', async () => {
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: createPaymentIssueBillingFixture({
				canManageBilling: false,
				notificationRecipients: [
					{
						recipientUserId: 'owner-1',
						recipientEmail: 'billing-owner@example.com',
						deliveryState: 'failed',
						retryEligible: true,
						failureReason: 'resend_delivery_failed'
					}
				]
			})
		});

		render(ContractsPage);

		await expect.element(page.getByText(/支払い遅延の猶予期間中です/)).toBeInTheDocument();
		await expect.element(page.getByText('billing-owner@example.com')).not.toBeInTheDocument();
		await expect.element(page.getByText('resend_delivery_failed')).not.toBeInTheDocument();
	});

	it('トライアル使用済み無料 Checkout 選択肢を表示し重複するトライアル導線を隠す', async () => {
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

	it('オーナー限定の支払いドキュメントと請求書イベントを表示する', async () => {
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
					aggregateRoot: 'billing_account',
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

	it('非オーナーには支払いドキュメントと請求書イベントを隠す', async () => {
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

	it('不明価格と課金プロフィール準備状態の案内を安全に表示する', async () => {
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
