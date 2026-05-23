import type {
  OrganizationBillingOperationPurpose,
  OrganizationBillingOperationState,
  OrganizationBillingOperationAttempt,
} from '../../domain/billing/organization-billing-operations.js';
import type { BillingOperationReuseKey } from '@repo/saas-billing-core';

export type CreateBillingOperationAttemptInput = {
  organizationId: string;
  purpose: OrganizationBillingOperationPurpose;
  billingInterval?: 'month' | 'year' | null;
  reuseKey?: BillingOperationReuseKey | null;
  stripeSubscriptionId?: string | null;
  createdByUserId?: string | null;
  now?: Date;
};

export type MarkBillingOperationAttemptSucceededInput = {
  attemptId: string;
  handoffUrl?: string | null;
  handoffExpiresAt?: Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripePortalSessionId?: string | null;
};

export type MarkBillingOperationAttemptFailedInput = {
  attemptId: string;
  state?: Extract<OrganizationBillingOperationState, 'conflict' | 'expired' | 'failed'>;
  failureReason: string;
};

export type BillingOperationStore = {
  createAttempt(input: CreateBillingOperationAttemptInput): Promise<{
    attempt: OrganizationBillingOperationAttempt;
    reused: boolean;
  }>;

  markSucceeded(
    input: MarkBillingOperationAttemptSucceededInput,
  ): Promise<OrganizationBillingOperationAttempt | null>;

  markFailed(
    input: MarkBillingOperationAttemptFailedInput,
  ): Promise<OrganizationBillingOperationAttempt | null>;
};
