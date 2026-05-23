import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import {
  readTrialReminderDeliveryAuditInspection,
  resolveReserveAppPaymentIssueNotificationRecipientPlans,
} from '../../domain/billing/reserve-app-billing-notifications.js';

export const createReserveAppBillingNotificationStore = (database: AuthRuntimeDatabase) => ({
  readTrialReminderDeliveryAuditInspection(
    input: Omit<Parameters<typeof readTrialReminderDeliveryAuditInspection>[0], 'database'>,
  ) {
    return readTrialReminderDeliveryAuditInspection({
      database,
      ...input,
    });
  },

  resolvePaymentIssueRecipientPlans(
    input: Parameters<typeof resolveReserveAppPaymentIssueNotificationRecipientPlans>[0],
  ) {
    return resolveReserveAppPaymentIssueNotificationRecipientPlans(input);
  },
});
