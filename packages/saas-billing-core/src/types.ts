/** 課金対象を SaaS ごとに拡張できる subject 種別。例: `organization`。 */
export type BillingSubjectType = string;

/** provider price と紐づける請求間隔。 */
export type BillingInterval = 'month' | 'year';

/** 現在サポートする課金 provider の識別子。 */
export type BillingProviderCode = 'stripe';

/** SaaS 側で entitlement と支払い制御に使う subscription 状態。 */
export type BillingSubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';

/** オーナー通知や猶予判定で扱う支払い問題の正規化状態。 */
export type BillingPaymentIssueState =
  | 'none'
  | 'payment_failed'
  | 'payment_action_required'
  | 'past_due_grace_active'
  | 'past_due_grace_expired'
  | 'unpaid'
  | 'incomplete'
  | 'recovered'
  | 'stale_failure_history_only';

/** 支払い問題の開始時刻を provider 由来とアプリ受領時刻で区別する分類。 */
export type BillingPaymentIssueStartedAtSource =
  | 'provider_issue_time'
  | 'application_receipt_time'
  | 'none';

/** entitlement がどの課金状態や運用操作から付与されたかを示す分類。 */
export type BillingEntitlementSource = 'free' | 'trial' | 'paid' | 'manual' | 'admin_override';

/** provider handoff を伴う課金操作の目的。 */
export type BillingOperationPurpose =
  | 'start_trial_subscription'
  | 'create_subscription_checkout'
  | 'create_setup_checkout'
  | 'create_portal_session';

/** Customer Portal 起動時に provider へ渡す遷移先 flow。 */
export type BillingPortalFlow =
  /** provider の既定ポータル画面へ遷移する。 */
  | { type: 'default' }
  /** 指定 subscription のプラン変更画面へ直接遷移する。 */
  | { type: 'subscription_update'; subscriptionId: string }
  /** 指定 subscription のキャンセル画面へ直接遷移する。 */
  | { type: 'subscription_cancel'; subscriptionId: string };
