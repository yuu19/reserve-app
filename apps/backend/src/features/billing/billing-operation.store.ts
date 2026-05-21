import type {
  createBillingOperationAttempt,
  markBillingOperationAttemptFailed,
  markBillingOperationAttemptSucceeded,
  OrganizationBillingOperationAttempt,
} from '../../domain/billing/organization-billing-operations.js';

export type CreateBillingOperationAttemptInput = Omit<
  Parameters<typeof createBillingOperationAttempt>[0],
  'database'
>;
export type MarkBillingOperationAttemptSucceededInput = Omit<
  Parameters<typeof markBillingOperationAttemptSucceeded>[0],
  'database'
>;
export type MarkBillingOperationAttemptFailedInput = Omit<
  Parameters<typeof markBillingOperationAttemptFailed>[0],
  'database'
>;

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
