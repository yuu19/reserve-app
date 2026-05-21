import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import { readInternalBillingInspection } from '../../domain/billing/internal-billing-inspection.js';
import { readOrganizationOwnerBillingHistory } from '../../domain/billing/organization-billing-history.js';
import {
  readOrganizationBillingDocumentReferences,
  readOrganizationBillingInvoicePaymentEvents,
} from '../../domain/billing/organization-billing-invoice-events.js';
import {
  appendOrganizationBillingAuditEvent,
  appendOrganizationBillingSignal,
  appendResolvedBillingSignalIfNeeded,
  readOrganizationBillingObservationSnapshot,
} from '../../domain/billing/organization-billing-observability.js';
import {
  applyOrganizationPremiumTrialCompletion,
  hasOrganizationStartedPremiumTrial,
  selectOrganizationBillingSummary,
  startOrganizationPremiumTrial,
  updateOrganizationBillingStripeCustomerId,
} from '../../domain/billing/organization-billing.js';
import type { OrganizationBillingStore } from '../../features/billing/billing.store.js';

export const createOrganizationBillingStore = ({
  database,
  env,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
}): OrganizationBillingStore => ({
  selectSummary: (organizationId) => selectOrganizationBillingSummary(database, organizationId),

  hasStartedPremiumTrial: ({ organizationId }) =>
    hasOrganizationStartedPremiumTrial({
      database,
      organizationId,
    }),

  updateStripeCustomerId: (input) =>
    updateOrganizationBillingStripeCustomerId({
      database,
      ...input,
    }),

  startPremiumTrial: (input) =>
    startOrganizationPremiumTrial({
      database,
      ...input,
    }),

  applyTrialCompletion: ({ organizationId }) =>
    applyOrganizationPremiumTrialCompletion({
      database,
      env,
      organizationId,
    }),

  readOwnerBillingHistory: ({ organizationId }) =>
    readOrganizationOwnerBillingHistory({
      database,
      organizationId,
    }),

  readInvoicePaymentEvents: ({ organizationId }) =>
    readOrganizationBillingInvoicePaymentEvents({
      database,
      organizationId,
    }),

  readDocumentReferences: ({ organizationId }) =>
    readOrganizationBillingDocumentReferences({
      database,
      organizationId,
    }),

  readObservationSnapshot: ({ organizationId }) =>
    readOrganizationBillingObservationSnapshot({
      database,
      env,
      organizationId,
    }),

  async appendAuditEvent(input) {
    await appendOrganizationBillingAuditEvent({
      database,
      ...input,
    });
  },

  async appendSignal(input) {
    await appendOrganizationBillingSignal({
      database,
      ...input,
    });
  },

  async appendResolvedSignalIfNeeded(input) {
    await appendResolvedBillingSignalIfNeeded({
      database,
      ...input,
    });
  },

  readInternalInspection: ({ organizationId }) =>
    readInternalBillingInspection({
      database,
      env,
      organizationId,
    }),
});
