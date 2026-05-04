import { eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';

export type OrganizationBillingProfileReadinessState =
  | 'complete'
  | 'incomplete'
  | 'unavailable'
  | 'not_required';

export type OrganizationBillingProfileReadiness = {
  state: OrganizationBillingProfileReadinessState;
  nextAction: string | null;
  checkedAt: string | null;
  gatesCheckout: false;
  gatesPremiumEligibility: false;
};

export const normalizeBillingProfileReadinessState = (
  value: unknown,
): OrganizationBillingProfileReadinessState => {
  return value === 'complete' ||
    value === 'incomplete' ||
    value === 'unavailable' ||
    value === 'not_required'
    ? value
    : 'not_required';
};

const toIsoDateString = (value: unknown): string | null => {
  const candidate =
    value instanceof Date
      ? value
      : typeof value === 'number' || typeof value === 'string'
        ? new Date(value)
        : null;

  if (!candidate || Number.isNaN(candidate.getTime())) {
    return null;
  }

  return candidate.toISOString();
};

export const buildBillingProfileReadiness = ({
  state,
  nextAction,
  checkedAt,
}: {
  state?: unknown;
  nextAction?: string | null;
  checkedAt?: unknown;
}): OrganizationBillingProfileReadiness => ({
  state: normalizeBillingProfileReadinessState(state),
  nextAction: nextAction && nextAction.length > 0 ? nextAction : null,
  checkedAt: toIsoDateString(checkedAt),
  gatesCheckout: false,
  gatesPremiumEligibility: false,
});

export const updateBillingProfileReadiness = async ({
  database,
  organizationId,
  state,
  nextAction = null,
  checkedAt = new Date(),
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  state: OrganizationBillingProfileReadinessState;
  nextAction?: string | null;
  checkedAt?: Date | null;
}) => {
  await database
    .update(dbSchema.organizationBilling)
    .set({
      billingProfileReadiness: state,
      billingProfileNextAction: nextAction,
      billingProfileCheckedAt: checkedAt,
      updatedAt: new Date(),
    })
    .where(eq(dbSchema.organizationBilling.organizationId, organizationId));
};

export const resolveBillingProfileSupportSignalReason = (
  readiness: OrganizationBillingProfileReadiness,
): 'missing_billing_profile' | 'billing_profile_unavailable' | null => {
  if (readiness.state === 'incomplete') {
    return 'missing_billing_profile';
  }
  if (readiness.state === 'unavailable') {
    return 'billing_profile_unavailable';
  }
  return null;
};

export const resolveBillingProfileOwnerNextAction = (
  readiness: OrganizationBillingProfileReadiness,
): string | null => {
  if (readiness.nextAction) {
    return readiness.nextAction;
  }

  if (readiness.state === 'incomplete') {
    return 'Complete billing profile details in the provider-hosted billing flow.';
  }
  if (readiness.state === 'unavailable') {
    return 'Billing profile readiness could not be confirmed. Retry the provider-hosted billing flow or contact support.';
  }
  return null;
};
