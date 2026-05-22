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
import type { OrganizationBillingStore } from '../../features/billing/billing.store.js';
import {
  applyReserveAppBillingV2TrialCompletion,
  hasReserveAppBillingV2StartedPremiumTrial,
  readReserveAppBillingV2Summary,
  startReserveAppBillingV2PremiumTrial,
  updateReserveAppBillingV2CustomerId,
} from './reserve-app-billing-v2-source.js';

export const createReserveAppBillingStore = ({
  database,
  env,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
}): OrganizationBillingStore => ({
  selectSummary: (organizationId) =>
    readReserveAppBillingV2Summary({
      database,
      env,
      organizationId,
    }),

  hasStartedPremiumTrial: ({ organizationId }) =>
    hasReserveAppBillingV2StartedPremiumTrial({
      database,
      env,
      organizationId,
    }),

  async updateStripeCustomerId(input) {
    await updateReserveAppBillingV2CustomerId({
      database,
      env,
      ...input,
    });
  },

  async startPremiumTrial(input) {
    return startReserveAppBillingV2PremiumTrial({
      database,
      env,
      ...input,
    });
  },

  async applyTrialCompletion({ organizationId }) {
    return applyReserveAppBillingV2TrialCompletion({
      database,
      env,
      organizationId,
    });
  },

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
