import type {
  BillingInterval,
  BillingOperationPurpose,
  BillingProviderCode,
  BillingSubjectType,
} from './types.js';

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

export type BillingOperationAttemptState =
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'conflict';

export type BillingOperationAttempt = {
  id: string;
  billingAccountId: string;
  purpose: BillingOperationPurpose;
  reuseKey: BillingOperationReuseKey;
  attemptNumber: number;
  idempotencyKey: string;
  state: BillingOperationAttemptState;
  handoffUrl: string | null;
  handoffExpiresAt: Date | null;
  provider: BillingProviderCode;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  providerCheckoutSessionId: string | null;
  providerPortalSessionId: string | null;
  failureReason: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ClaimBillingOperationAttemptResult =
  | { kind: 'claimed'; attempt: BillingOperationAttempt }
  | { kind: 'reused_succeeded'; attempt: BillingOperationAttempt }
  | { kind: 'already_processing_fresh'; attempt: BillingOperationAttempt };

export interface BillingOperationStore {
  claimAttempt(input: {
    billingAccountId: string;
    purpose: BillingOperationPurpose;
    reuseKey: BillingOperationReuseKey;
    provider: BillingProviderCode;
    createdByUserId?: string | null;
    now: Date;
  }): Promise<ClaimBillingOperationAttemptResult>;

  markSucceeded(input: {
    attemptId: string;
    handoffUrl?: string | null;
    handoffExpiresAt?: Date | null;
    providerCustomerId?: string | null;
    providerSubscriptionId?: string | null;
    providerCheckoutSessionId?: string | null;
    providerPortalSessionId?: string | null;
  }): Promise<BillingOperationAttempt | null>;

  markFailed(input: {
    attemptId: string;
    state?: Extract<BillingOperationAttemptState, 'conflict' | 'expired' | 'failed'>;
    failureReason: string;
  }): Promise<BillingOperationAttempt | null>;

  readRecent(input: {
    billingAccountId: string;
    limit?: number;
  }): Promise<BillingOperationAttempt[]>;
}

export const BILLING_OPERATION_PENDING_STALE_MS = 2 * 60 * 1000;

export const buildBillingOperationIdempotencyKey = ({
  reuseKey,
  attemptNumber,
}: {
  reuseKey: BillingOperationReuseKey;
  attemptNumber: number;
}) => `billing:${reuseKey}:${attemptNumber}`;

export const buildStartTrialSubscriptionReuseKey = ({
  subjectType,
  subjectId,
  planCode,
}: {
  subjectType: BillingSubjectType;
  subjectId: string;
  planCode: string;
}): BillingOperationReuseKey => `start_trial_subscription:${subjectType}:${subjectId}:${planCode}`;

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
