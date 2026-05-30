import { describe, expect, it } from 'vitest';
import {
  resolveOrganizationBillingPaymentIssueState,
  resolveOrganizationBillingPaymentIssueTiming,
} from './organization-billing.js';
import {
  resolveReserveAppBillingPaidTier,
  resolveReserveAppPremiumEntitlementPolicy,
} from './reserve-app-billing-entitlement-policy.js';

describe('reserve-app プレミアム課金エンタイトルメントポリシー', () => {
  const now = new Date('2026-04-09T12:00:00.000Z');

  it('無料組織には無料専用エンタイトルメントを返す', () => {
    const result = resolveReserveAppPremiumEntitlementPolicy({
      planCode: 'free',
      subscriptionStatus: 'free',
      paymentMethodStatus: 'not_started',
      currentPeriodEnd: null,
      now,
    });

    expect(result).toMatchObject({
      scope: 'organization',
      source: 'application_billing_state',
      planState: 'free',
      trialEndsAt: null,
      entitlementState: 'free_only',
      isPremiumEligible: false,
      reason: 'organization_plan_is_free',
    });
  });

  it('アクティブなプレミアムトライアルを組織全体で有効に保つ', () => {
    const result = resolveReserveAppPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      paymentMethodStatus: 'pending',
      currentPeriodEnd: '2026-04-12T12:00:00.000Z',
      now,
    });

    expect(result).toMatchObject({
      scope: 'organization',
      source: 'application_billing_state',
      planState: 'premium_trial',
      trialEndsAt: '2026-04-12T12:00:00.000Z',
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_trial_active',
    });
  });

  it('アクティブトライアルに支払い方法が登録済みの場合は専用の理由を公開する', () => {
    const result = resolveReserveAppPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: '2026-04-12T12:00:00.000Z',
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_trial',
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_trial_active_with_payment_method_registered',
    });
  });

  it('課金状態が trialing でもトライアル終了後はプレミアム資格を外す', () => {
    const result = resolveReserveAppPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      paymentMethodStatus: 'pending',
      currentPeriodEnd: '2026-04-09T11:59:59.000Z',
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_trial',
      trialEndsAt: '2026-04-09T11:59:59.000Z',
      entitlementState: 'free_only',
      isPremiumEligible: false,
      reason: 'premium_trial_expired',
    });
  });

  it('トライアル終了情報がない場合はプレミアムアクセスを仮定せず対象外にする', () => {
    const result = resolveReserveAppPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      paymentMethodStatus: 'pending',
      currentPeriodEnd: null,
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_trial',
      entitlementState: 'free_only',
      isPremiumEligible: false,
      reason: 'premium_trial_missing_end',
    });
  });

  it('アクティブな有料購読を有効に保つ', () => {
    const result = resolveReserveAppPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'active',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: null,
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_paid',
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_paid_active',
      paidTier: {
        code: 'premium_default',
        label: 'Premium',
        resolution: 'legacy_default',
        capabilities: ['organization_premium_features'],
      },
    });
  });

  it('past_due を 7 日間の猶予期間中は有効に保つ', () => {
    const result = resolveReserveAppPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'past_due',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: null,
      pastDueGraceEndsAt: '2026-04-10T12:00:00.000Z',
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_paid',
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_paid_past_due_grace_active',
    });
  });

  it('past_due 猶予期限切れ後はプレミアムを停止する', () => {
    const result = resolveReserveAppPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'past_due',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: null,
      pastDueGraceEndsAt: '2026-04-09T11:59:59.000Z',
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_paid',
      entitlementState: 'free_only',
      isPremiumEligible: false,
      reason: 'premium_paid_past_due_grace_expired',
    });
  });

  it('unpaid・incomplete・canceled の有料状態では即座にプレミアムを停止する', () => {
    for (const [subscriptionStatus, reason] of [
      ['unpaid', 'premium_paid_unpaid'],
      ['incomplete', 'premium_paid_incomplete'],
      ['canceled', 'premium_paid_canceled'],
    ] as const) {
      const result = resolveReserveAppPremiumEntitlementPolicy({
        planCode: 'premium',
        subscriptionStatus,
        paymentMethodStatus: 'registered',
        currentPeriodEnd: null,
        now,
      });

      expect(result).toMatchObject({
        planState: 'premium_paid',
        entitlementState: 'free_only',
        isPremiumEligible: false,
        reason,
      });
    }
  });

  it('プロバイダー時刻とアプリケーション受領時刻のフォールバックから支払い問題のタイミングを分類する', () => {
    expect(
      resolveOrganizationBillingPaymentIssueTiming({
        paymentIssueStartedAt: '2026-05-01T09:00:00.000Z',
        providerIssueStartedAt: '2026-05-01T09:00:00.000Z',
        pastDueGraceEndsAt: '2026-05-08T09:00:00.000Z',
      }),
    ).toEqual({
      issueStartedAt: '2026-05-01T09:00:00.000Z',
      issueStartedAtSource: 'provider_issue_time',
      graceEndsAt: '2026-05-08T09:00:00.000Z',
    });

    expect(
      resolveOrganizationBillingPaymentIssueTiming({
        paymentIssueStartedAt: '2026-05-01T09:05:00.000Z',
        providerIssueStartedAt: null,
        pastDueGraceEndsAt: '2026-05-08T09:05:00.000Z',
      }),
    ).toEqual({
      issueStartedAt: '2026-05-01T09:05:00.000Z',
      issueStartedAtSource: 'application_receipt_time',
      graceEndsAt: '2026-05-08T09:05:00.000Z',
    });
  });

  it('未解決・復旧済み・古い支払い問題状態を分類する', () => {
    expect(
      resolveOrganizationBillingPaymentIssueState({
        subscriptionStatus: 'past_due',
        entitlementReason: 'premium_paid_past_due_grace_active',
        latestPaymentIssueEventType: 'payment_failed',
      }),
    ).toBe('past_due_grace_active');
    expect(
      resolveOrganizationBillingPaymentIssueState({
        subscriptionStatus: 'past_due',
        entitlementReason: 'premium_paid_past_due_grace_expired',
        latestPaymentIssueEventType: 'payment_failed',
      }),
    ).toBe('past_due_grace_expired');
    expect(
      resolveOrganizationBillingPaymentIssueState({
        subscriptionStatus: 'unpaid',
      }),
    ).toBe('unpaid');
    expect(
      resolveOrganizationBillingPaymentIssueState({
        subscriptionStatus: 'incomplete',
      }),
    ).toBe('incomplete');
    expect(
      resolveOrganizationBillingPaymentIssueState({
        subscriptionStatus: 'active',
        latestPaymentIssueEventType: 'payment_succeeded',
        hasRecoveredPaymentIssueHistory: true,
      }),
    ).toBe('recovered');
    expect(
      resolveOrganizationBillingPaymentIssueState({
        subscriptionStatus: 'active',
        hasStaleFailureHistory: true,
      }),
    ).toBe('stale_failure_history_only');
  });

  it('プロバイダー状態が変わるまで期間末キャンセル予定を有効に保つ', () => {
    const result = resolveReserveAppPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'active',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: '2026-05-01T00:00:00.000Z',
      cancelAtPeriodEnd: true,
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_paid',
      entitlementState: 'premium_enabled',
      isPremiumEligible: true,
      reason: 'premium_paid_scheduled_cancellation_active',
    });
  });

  it('既存のプレミアム価格 ID を既定の有料ティアへマッピングし利用側にプロバイダー ID を漏らさない', () => {
    const result = resolveReserveAppBillingPaidTier({
      planCode: 'premium',
      stripePriceId: 'price_current_monthly',
      env: {
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: 'price_current_monthly',
        STRIPE_PREMIUM_YEARLY_PRICE_ID: 'price_current_yearly',
      },
    });

    expect(result).toMatchObject({
      code: 'premium_default',
      label: 'Premium',
      resolution: 'known_price',
      capabilities: ['organization_premium_features'],
    });
  });

  it('明示的なカタログ定義で将来のティア機能セットをサポートする', () => {
    const result = resolveReserveAppBillingPaidTier({
      planCode: 'premium',
      stripePriceId: 'price_growth_monthly',
      env: {
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: 'price_current_monthly',
      },
      additionalCatalogEntries: [
        {
          code: 'premium_growth',
          label: 'Premium Growth',
          capabilities: ['organization_premium_features', 'advanced_billing_communications'],
          priceIds: ['price_growth_monthly'],
        },
      ],
    });

    expect(result).toMatchObject({
      code: 'premium_growth',
      label: 'Premium Growth',
      resolution: 'known_price',
      capabilities: ['organization_premium_features', 'advanced_billing_communications'],
    });
  });

  it('不明な有料プロバイダー価格を機能付与なしで公開する', () => {
    const result = resolveReserveAppBillingPaidTier({
      planCode: 'premium',
      stripePriceId: 'price_unmapped_provider_value',
      env: {
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: 'price_current_monthly',
      },
    });

    expect(result).toMatchObject({
      code: 'premium_unknown',
      label: 'Premium',
      resolution: 'unknown_price',
      diagnosticReason: 'stripe_price_id_not_in_paid_tier_catalog',
      capabilities: [],
    });
    expect(result.capabilities).not.toContain('advanced_billing_communications');
  });

  it('不明な有料プロバイダー価格ではプレミアム資格を停止する', () => {
    const result = resolveReserveAppPremiumEntitlementPolicy({
      planCode: 'premium',
      subscriptionStatus: 'active',
      paymentMethodStatus: 'registered',
      currentPeriodEnd: null,
      stripePriceId: 'price_unmapped_provider_value',
      env: {
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: 'price_current_monthly',
      },
      now,
    });

    expect(result).toMatchObject({
      planState: 'premium_paid',
      entitlementState: 'free_only',
      isPremiumEligible: false,
      reason: 'premium_paid_unknown_price',
      paidTier: {
        code: 'premium_unknown',
        resolution: 'unknown_price',
      },
    });
  });
});
