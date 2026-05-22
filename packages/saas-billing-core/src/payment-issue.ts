import type { BillingPaymentIssueState, BillingSubscriptionStatus } from './types.js';

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
