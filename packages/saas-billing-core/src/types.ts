export type BillingSubjectType = 'organization' | 'workspace' | 'team' | 'user';

export type BillingInterval = 'month' | 'year';

export type BillingProviderCode = 'stripe';

export type BillingOperationPurpose =
  | 'start_trial_subscription'
  | 'create_subscription_checkout'
  | 'create_setup_checkout'
  | 'create_portal_session';

export type BillingPortalFlow =
  | { type: 'default' }
  | { type: 'subscription_update'; subscriptionId: string }
  | { type: 'subscription_cancel'; subscriptionId: string };
