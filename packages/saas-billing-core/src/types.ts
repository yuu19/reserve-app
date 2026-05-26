export type BillingSubjectType = string;

export type BillingInterval = 'month' | 'year';

export type BillingProviderCode = 'stripe';

export type BillingSubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';

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

export type BillingPaymentIssueStartedAtSource =
  | 'provider_issue_time'
  | 'application_receipt_time'
  | 'none';

export type BillingEntitlementSource = 'free' | 'trial' | 'paid' | 'manual' | 'admin_override';

export type BillingOperationPurpose =
  | 'start_trial_subscription'
  | 'create_subscription_checkout'
  | 'create_setup_checkout'
  | 'create_portal_session';

export type BillingPortalFlow =
  | { type: 'default' }
  | { type: 'subscription_update'; subscriptionId: string }
  | { type: 'subscription_cancel'; subscriptionId: string };
