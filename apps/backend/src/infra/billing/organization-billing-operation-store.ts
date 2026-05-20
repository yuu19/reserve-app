import type { BillingOperationReuseKey } from '@repo/saas-billing-core';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import {
  createBillingOperationAttempt,
  markBillingOperationAttemptFailed,
  markBillingOperationAttemptSucceeded,
  readRecentBillingOperationAttempts,
  readReusableBillingOperationAttempt,
  type OrganizationBillingOperationPurpose,
  type OrganizationBillingOperationState,
} from '../../domain/billing/organization-billing-operations.js';

export const createOrganizationBillingOperationStore = (database: AuthRuntimeDatabase) => ({
  claimAttempt(input: {
    organizationId: string;
    purpose: OrganizationBillingOperationPurpose;
    billingInterval?: 'month' | 'year' | null;
    reuseKey?: BillingOperationReuseKey | null;
    stripeSubscriptionId?: string | null;
    createdByUserId?: string | null;
    now?: Date;
  }) {
    return createBillingOperationAttempt({
      database,
      ...input,
    });
  },

  readReusableAttempt(input: {
    organizationId: string;
    purpose: OrganizationBillingOperationPurpose;
    billingInterval?: 'month' | 'year' | null;
    reuseKey?: BillingOperationReuseKey | null;
    now?: Date;
  }) {
    return readReusableBillingOperationAttempt({
      database,
      ...input,
    });
  },

  markSucceeded(input: Omit<Parameters<typeof markBillingOperationAttemptSucceeded>[0], 'database'>) {
    return markBillingOperationAttemptSucceeded({
      database,
      ...input,
    });
  },

  markFailed(
    input: Omit<Parameters<typeof markBillingOperationAttemptFailed>[0], 'database'> & {
      state?: Extract<OrganizationBillingOperationState, 'conflict' | 'expired' | 'failed'>;
    },
  ) {
    return markBillingOperationAttemptFailed({
      database,
      ...input,
    });
  },

  readRecent(organizationId: string, limit?: number) {
    return readRecentBillingOperationAttempts({
      database,
      organizationId,
      limit,
    });
  },
});
