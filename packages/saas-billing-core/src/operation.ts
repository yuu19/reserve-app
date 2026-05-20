import type { BillingInterval, BillingOperationPurpose, BillingSubjectType } from './types.js';

export type BillingOperationReuseKey =
  | `start_trial_subscription:${BillingSubjectType}:${string}:${string}`
  | `create_subscription_checkout:${BillingSubjectType}:${string}:${string}:${BillingInterval}`
  | `create_setup_checkout:${BillingSubjectType}:${string}`
  | `create_portal_session:${BillingSubjectType}:${string}:default`
  | `create_portal_session:${BillingSubjectType}:${string}:subscription_update:${string}`
  | `create_portal_session:${BillingSubjectType}:${string}:subscription_cancel:${string}`;

export type BillingOperationHandoff = {
  provider: 'stripe';
  purpose: BillingOperationPurpose;
  url: string;
  expiresAt: Date;
  operationAttemptId: string;
  reused: boolean;
};

export const buildStartTrialSubscriptionReuseKey = ({
  subjectType,
  subjectId,
  planCode,
}: {
  subjectType: BillingSubjectType;
  subjectId: string;
  planCode: string;
}): BillingOperationReuseKey =>
  `start_trial_subscription:${subjectType}:${subjectId}:${planCode}`;

export const buildSubscriptionCheckoutReuseKey = ({
  subjectType,
  subjectId,
  planCode,
  interval,
}: {
  subjectType: BillingSubjectType;
  subjectId: string;
  planCode: string;
  interval: BillingInterval;
}): BillingOperationReuseKey =>
  `create_subscription_checkout:${subjectType}:${subjectId}:${planCode}:${interval}`;

export const buildSetupCheckoutReuseKey = ({
  subjectType,
  subjectId,
}: {
  subjectType: BillingSubjectType;
  subjectId: string;
}): BillingOperationReuseKey => `create_setup_checkout:${subjectType}:${subjectId}`;

export const buildPortalSessionReuseKey = ({
  subjectType,
  subjectId,
  flow,
}: {
  subjectType: BillingSubjectType;
  subjectId: string;
  flow:
    | { type: 'default' }
    | { type: 'subscription_update'; subscriptionId: string }
    | { type: 'subscription_cancel'; subscriptionId: string };
}): BillingOperationReuseKey => {
  if (flow.type === 'subscription_update') {
    return `create_portal_session:${subjectType}:${subjectId}:subscription_update:${flow.subscriptionId}`;
  }
  if (flow.type === 'subscription_cancel') {
    return `create_portal_session:${subjectType}:${subjectId}:subscription_cancel:${flow.subscriptionId}`;
  }
  return `create_portal_session:${subjectType}:${subjectId}:default`;
};
