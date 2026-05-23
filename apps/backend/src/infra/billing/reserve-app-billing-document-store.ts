import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { buildBillingDocumentReadiness } from '../../domain/billing/organization-billing-documents.js';
import { readReserveAppBillingDocumentReferences } from '../../domain/billing/reserve-app-billing-invoice-events.js';

export const createReserveAppBillingDocumentStore = (database: AuthRuntimeDatabase) => ({
  readDocumentReferences(organizationId: string) {
    return readReserveAppBillingDocumentReferences({
      database,
      organizationId,
    });
  },

  buildReadiness(input: Parameters<typeof buildBillingDocumentReadiness>[0]) {
    return buildBillingDocumentReadiness(input);
  },
});
