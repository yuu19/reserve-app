import type { BillingOperationReuseKey } from '@repo/saas-billing-core';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import {
  createBillingOperationAttempt,
  markBillingOperationAttemptFailed,
  markBillingOperationAttemptSucceeded,
  readRecentBillingOperationAttempts,
  readReusableBillingOperationAttempt,
  type OrganizationBillingOperationPurpose,
} from '../../domain/billing/organization-billing-operations.js';
import type { BillingOperationStore } from '../../features/billing/billing-operation.store.js';

export const createOrganizationBillingOperationStore = ({
  database,
}: {
  database: AuthRuntimeDatabase;
}): BillingOperationStore & {
  claimAttempt(
    input: Omit<Parameters<typeof createBillingOperationAttempt>[0], 'database'>,
  ): ReturnType<typeof createBillingOperationAttempt>;
  readReusableAttempt(input: {
    organizationId: string;
    purpose: OrganizationBillingOperationPurpose;
    billingInterval?: 'month' | 'year' | null;
    reuseKey?: BillingOperationReuseKey | null;
    now?: Date;
  }): ReturnType<typeof readReusableBillingOperationAttempt>;
  readRecent(
    organizationId: string,
    limit?: number,
  ): ReturnType<typeof readRecentBillingOperationAttempts>;
} => ({
  createAttempt(input) {
    return createBillingOperationAttempt({
      database,
      ...input,
    });
  },

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

  markSucceeded(
    input: Omit<Parameters<typeof markBillingOperationAttemptSucceeded>[0], 'database'>,
  ) {
    return markBillingOperationAttemptSucceeded({
      database,
      ...input,
    });
  },

  markFailed(input) {
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
