import type { BillingPaymentIssueState, BillingSubscriptionStatus } from './types.js';

/**
 * subscription 状態と最新の支払いイベントから owner-facing な支払い問題状態を決める。
 *
 * @param input.subscriptionStatus SaaS 側に正規化済みの subscription 状態。
 * @param input.graceActive past_due の猶予期間が現在有効かどうか。
 * @param input.latestPaymentIssueEventType 最新の支払い失敗・要対応・成功イベント種別。
 * @param input.recovered 最新成功イベントを復旧として扱える場合は `true`。
 * @param input.staleFailureHistoryOnly 後続成功より古い失敗履歴だけが残っている場合は `true`。
 * @returns 通知、表示、entitlement 制御で共有する支払い問題状態。
 */
export const resolveBillingPaymentIssueStateFromSubscription = ({
  subscriptionStatus,
  graceActive,
  latestPaymentIssueEventType = null,
  recovered = false,
  staleFailureHistoryOnly = false,
}: {
  subscriptionStatus: BillingSubscriptionStatus;
  graceActive?: boolean;
  latestPaymentIssueEventType?:
    | 'payment_failed'
    | 'payment_action_required'
    | 'payment_succeeded'
    | null;
  recovered?: boolean;
  staleFailureHistoryOnly?: boolean;
}): BillingPaymentIssueState => {
  if (subscriptionStatus === 'past_due') {
    return graceActive ? 'past_due_grace_active' : 'past_due_grace_expired';
  }
  if (subscriptionStatus === 'unpaid') {
    return 'unpaid';
  }
  if (subscriptionStatus === 'incomplete') {
    return 'incomplete';
  }
  if (staleFailureHistoryOnly) {
    return 'stale_failure_history_only';
  }
  if (latestPaymentIssueEventType === 'payment_succeeded' && recovered) {
    return 'recovered';
  }
  if (latestPaymentIssueEventType === 'payment_action_required') {
    return 'payment_action_required';
  }
  if (latestPaymentIssueEventType === 'payment_failed') {
    return 'payment_failed';
  }
  return 'none';
};
