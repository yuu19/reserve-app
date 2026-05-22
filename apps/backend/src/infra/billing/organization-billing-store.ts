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
  startOrganizationPremiumTrial,
  updateOrganizationBillingStripeCustomerId,
} from '../../domain/billing/organization-billing.js';
import type { OrganizationBillingStore } from '../../features/billing/billing.store.js';
import {
  readReserveAppBillingV2Summary,
  syncReserveAppBillingV2Projection,
} from './reserve-app-billing-projection.js';

export const createOrganizationBillingStore = ({
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
    hasOrganizationStartedPremiumTrial({
      database,
      organizationId,
    }),

  async updateStripeCustomerId(input) {
    await updateOrganizationBillingStripeCustomerId({
      database,
      ...input,
    });
    await syncReserveAppBillingV2Projection({
      database,
      env,
      organizationId: input.organizationId,
    });
  },

  async startPremiumTrial(input) {
    const result = await startOrganizationPremiumTrial({
      database,
      ...input,
    });
    await syncReserveAppBillingV2Projection({
      database,
      env,
      organizationId: input.organizationId,
    });
    return result;
  },

  async applyTrialCompletion({ organizationId }) {
    const result = await applyOrganizationPremiumTrialCompletion({
      database,
      env,
      organizationId,
    });
    if (result.ok) {
      await syncReserveAppBillingV2Projection({
        database,
        env,
        organizationId,
      });
    }
    return result;
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
