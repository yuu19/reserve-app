import type { BillingOperationAttempt, BillingOperationPurpose } from '@repo/saas-billing-core';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import {
  buildOrganizationBillingOperationReuseKey,
  type OrganizationBillingOperationAttempt,
  type OrganizationBillingOperationPurpose,
} from '../../domain/billing/organization-billing-operations.js';
import type { BillingOperationStore } from '../../features/billing/billing-operation.store.js';
import * as dbSchema from '../db/schema.js';
import { createDrizzleBillingOperationStore } from './drizzle-billing-operation-store.js';
import { createDrizzleBillingStore } from './drizzle-billing-store.js';
import { eq } from 'drizzle-orm';

const toGenericPurpose = (
  purpose: OrganizationBillingOperationPurpose,
): BillingOperationPurpose => {
  if (purpose === 'trial_start') {
    return 'start_trial_subscription';
  }
  if (purpose === 'payment_method_setup') {
    return 'create_setup_checkout';
  }
  if (purpose === 'billing_portal') {
    return 'create_portal_session';
  }
  return 'create_subscription_checkout';
};

const toOrganizationPurpose = (
  purpose: BillingOperationPurpose,
): OrganizationBillingOperationPurpose => {
  if (purpose === 'start_trial_subscription') {
    return 'trial_start';
  }
  if (purpose === 'create_setup_checkout') {
    return 'payment_method_setup';
  }
  if (purpose === 'create_portal_session') {
    return 'billing_portal';
  }
  return 'paid_checkout';
};

const resolveBillingIntervalFromReuseKey = (reuseKey: string): 'month' | 'year' | null => {
  const lastSegment = reuseKey.split(':').at(-1);
  return lastSegment === 'month' || lastSegment === 'year' ? lastSegment : null;
};

const readOrganizationIdForBillingAccount = async ({
  database,
  billingAccountId,
}: {
  database: AuthRuntimeDatabase;
  billingAccountId: string;
}) => {
  const rows = await database
    .select({
      subjectType: dbSchema.billingAccount.subjectType,
      subjectId: dbSchema.billingAccount.subjectId,
    })
    .from(dbSchema.billingAccount)
    .where(eq(dbSchema.billingAccount.id, billingAccountId))
    .limit(1);
  const account = rows[0];
  return account?.subjectType === 'organization' ? account.subjectId : billingAccountId;
};

const toOrganizationAttempt = ({
  attempt,
  organizationId,
}: {
  attempt: BillingOperationAttempt;
  organizationId: string;
}): OrganizationBillingOperationAttempt => ({
  id: attempt.id,
  organizationId,
  purpose: toOrganizationPurpose(attempt.purpose),
  billingInterval: resolveBillingIntervalFromReuseKey(attempt.reuseKey),
  state: attempt.state,
  handoffUrl: attempt.handoffUrl,
  handoffExpiresAt: attempt.handoffExpiresAt,
  provider: 'stripe',
  stripeCustomerId: attempt.providerCustomerId,
  stripeSubscriptionId: attempt.providerSubscriptionId,
  stripeCheckoutSessionId: attempt.providerCheckoutSessionId,
  stripePortalSessionId: attempt.providerPortalSessionId,
  reuseKey: attempt.reuseKey,
  idempotencyKey: attempt.idempotencyKey,
  failureReason: attempt.failureReason,
  createdByUserId: attempt.createdByUserId,
  createdAt: attempt.createdAt,
  updatedAt: attempt.updatedAt,
});

export const createReserveAppBillingOperationStore = ({
  database,
}: {
  database: AuthRuntimeDatabase;
}): BillingOperationStore => {
  const billingStore = createDrizzleBillingStore({ database });
  const operationStore = createDrizzleBillingOperationStore({ database });

  return {
    async createAttempt({
      organizationId,
      purpose,
      billingInterval = null,
      reuseKey: requestedReuseKey,
      stripeSubscriptionId = null,
      createdByUserId = null,
      now = new Date(),
    }) {
      const account = await billingStore.ensureAccount({
        subjectType: 'organization',
        subjectId: organizationId,
        provider: 'stripe',
      });
      const reuseKey =
        requestedReuseKey ??
        buildOrganizationBillingOperationReuseKey({
          organizationId,
          purpose,
          billingInterval,
          stripeSubscriptionId,
        });
      const result = await operationStore.claimAttempt({
        billingAccountId: account.id,
        purpose: toGenericPurpose(purpose),
        reuseKey,
        provider: 'stripe',
        createdByUserId,
        now,
      });

      return {
        attempt: toOrganizationAttempt({
          attempt: result.attempt,
          organizationId,
        }),
        reused: result.kind !== 'claimed',
      };
    },

    async markSucceeded({
      attemptId,
      handoffUrl = null,
      handoffExpiresAt = null,
      stripeCustomerId = null,
      stripeSubscriptionId = null,
      stripeCheckoutSessionId = null,
      stripePortalSessionId = null,
    }) {
      const attempt = await operationStore.markSucceeded({
        attemptId,
        handoffUrl,
        handoffExpiresAt,
        providerCustomerId: stripeCustomerId,
        providerSubscriptionId: stripeSubscriptionId,
        providerCheckoutSessionId: stripeCheckoutSessionId,
        providerPortalSessionId: stripePortalSessionId,
      });
      if (!attempt) {
        return null;
      }
      const organizationId = await readOrganizationIdForBillingAccount({
        database,
        billingAccountId: attempt.billingAccountId,
      });
      return toOrganizationAttempt({ attempt, organizationId });
    },

    async markFailed({ attemptId, state = 'failed', failureReason }) {
      const attempt = await operationStore.markFailed({
        attemptId,
        state,
        failureReason,
      });
      if (!attempt) {
        return null;
      }
      const organizationId = await readOrganizationIdForBillingAccount({
        database,
        billingAccountId: attempt.billingAccountId,
      });
      return toOrganizationAttempt({ attempt, organizationId });
    },
  };
};
