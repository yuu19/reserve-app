import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import {
  readTrialReminderDeliveryAuditInspection,
  resolveOrganizationBillingPaymentIssueNotificationRecipientPlans,
} from '../../domain/billing/organization-billing-notifications.js';

export const createOrganizationBillingNotificationStore = (database: AuthRuntimeDatabase) => ({
  readTrialReminderDeliveryAuditInspection(
    input: Omit<Parameters<typeof readTrialReminderDeliveryAuditInspection>[0], 'database'>,
  ) {
    return readTrialReminderDeliveryAuditInspection({
      database,
      ...input,
    });
  },

  resolvePaymentIssueRecipientPlans(
    input: Parameters<typeof resolveOrganizationBillingPaymentIssueNotificationRecipientPlans>[0],
  ) {
    return resolveOrganizationBillingPaymentIssueNotificationRecipientPlans(input);
  },
});
