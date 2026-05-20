import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import {
  ensureOrganizationBillingRow,
  selectOrganizationBillingSummary,
  startOrganizationPremiumTrial,
  updateOrganizationBillingStripeCustomerId,
} from '../../domain/billing/organization-billing.js';

export const createOrganizationBillingStore = (database: AuthRuntimeDatabase) => ({
  ensureOrganizationBillingRow(organizationId: string) {
    return ensureOrganizationBillingRow(database, organizationId);
  },

  readOrganizationBillingSummary(organizationId: string) {
    return selectOrganizationBillingSummary(database, organizationId);
  },

  updateStripeCustomerId({
    organizationId,
    stripeCustomerId,
  }: {
    organizationId: string;
    stripeCustomerId: string;
  }) {
    return updateOrganizationBillingStripeCustomerId({
      database,
      organizationId,
      stripeCustomerId,
    });
  },

  startPremiumTrial(input: Omit<Parameters<typeof startOrganizationPremiumTrial>[0], 'database'>) {
    return startOrganizationPremiumTrial({
      database,
      ...input,
    });
  },
});
