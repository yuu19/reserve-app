import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import { readInternalBillingInspection } from '../../domain/billing/internal-billing-inspection.js';
import { readReserveAppOwnerBillingHistory } from '../../domain/billing/reserve-app-billing-history.js';
import {
  readReserveAppBillingDocumentReferences,
  readReserveAppBillingInvoiceEvents,
} from '../../domain/billing/reserve-app-billing-invoice-events.js';
import {
  appendReserveAppBillingAuditEvent,
  appendReserveAppBillingSignal,
  appendResolvedReserveAppBillingSignalIfNeeded,
  readReserveAppBillingObservationSnapshot,
} from '../../domain/billing/reserve-app-billing-observability.js';
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
    readReserveAppOwnerBillingHistory({
      database,
      organizationId,
    }),

  readInvoicePaymentEvents: ({ organizationId }) =>
    readReserveAppBillingInvoiceEvents({
      database,
      organizationId,
    }),

  readDocumentReferences: ({ organizationId }) =>
    readReserveAppBillingDocumentReferences({
      database,
      organizationId,
    }),

  readObservationSnapshot: ({ organizationId }) =>
    readReserveAppBillingObservationSnapshot({
      database,
      env,
      organizationId,
    }),

  async appendAuditEvent(input) {
    await appendReserveAppBillingAuditEvent({
      database,
      ...input,
    });
  },

  async appendSignal(input) {
    await appendReserveAppBillingSignal({
      database,
      ...input,
    });
  },

  async appendResolvedSignalIfNeeded(input) {
    await appendResolvedReserveAppBillingSignalIfNeeded({
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
