import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { buildBillingDocumentReadiness } from '../../domain/billing/organization-billing-documents.js';
import { readOrganizationBillingDocumentReferences } from '../../domain/billing/organization-billing-invoice-events.js';

export const createOrganizationBillingDocumentStore = (database: AuthRuntimeDatabase) => ({
  readDocumentReferences(organizationId: string) {
    return readOrganizationBillingDocumentReferences({
      database,
      organizationId,
    });
  },

  buildReadiness(input: Parameters<typeof buildBillingDocumentReadiness>[0]) {
    return buildBillingDocumentReadiness(input);
  },
});
