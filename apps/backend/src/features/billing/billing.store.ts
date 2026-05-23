import type { readInternalBillingInspection } from '../../domain/billing/internal-billing-inspection.js';
import type { buildBillingDocumentReadiness } from '../../domain/billing/organization-billing-documents.js';
import type { readReserveAppOwnerBillingHistory } from '../../domain/billing/reserve-app-billing-history.js';
import type { ReserveAppBillingInvoiceEvent } from '../../domain/billing/reserve-app-billing-invoice-events.js';
import type {
  appendReserveAppBillingAuditEvent,
  appendReserveAppBillingSignal,
  appendResolvedReserveAppBillingSignalIfNeeded,
  readReserveAppBillingObservationSnapshot,
} from '../../domain/billing/reserve-app-billing-observability.js';
import type {
  ReserveAppBillingPlanCode,
  ReserveAppBillingSubscriptionStatus,
} from './policies/reserve-app-billing-policy.js';

export type ReserveAppBillingSummaryRow = {
  planCode: ReserveAppBillingPlanCode;
  billingInterval: 'month' | 'year' | null;
  subscriptionStatus: ReserveAppBillingSubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  trialStartedAt: Date | null;
  trialEndedAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  paymentIssueStartedAt: Date | null;
  pastDueGraceEndsAt: Date | null;
  billingProfileReadiness: string;
  billingProfileNextAction: string | null;
  billingProfileCheckedAt: Date | null;
  lastReconciledAt: Date | null;
  lastReconciliationReason: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
} | null;
export type StartReserveAppPremiumTrialInput = {
  organizationId: string;
  now?: Date;
  trialStartedAt?: Date;
  trialEndsAt?: Date;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  billingInterval?: 'month' | 'year' | null;
};
export type TrialCompletionResult =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      status: 409 | 422 | 503;
      message: string;
    };
export type ReserveAppBillingHistoryResult = Awaited<
  ReturnType<typeof readReserveAppOwnerBillingHistory>
>;
export type ReserveAppBillingDocumentReferences = Parameters<
  typeof buildBillingDocumentReadiness
>[0]['documents'];
export type ReserveAppBillingObservationSnapshot = Awaited<
  ReturnType<typeof readReserveAppBillingObservationSnapshot>
>;
export type AppendReserveAppBillingAuditEventInput = Omit<
  Parameters<typeof appendReserveAppBillingAuditEvent>[0],
  'database'
>;
export type AppendReserveAppBillingSignalInput = Omit<
  Parameters<typeof appendReserveAppBillingSignal>[0],
  'database'
>;
export type AppendResolvedReserveAppBillingSignalInput = Omit<
  Parameters<typeof appendResolvedReserveAppBillingSignalIfNeeded>[0],
  'database'
>;
export type InternalBillingInspection = Awaited<ReturnType<typeof readInternalBillingInspection>>;

/**
 * reserve-app の billing v2 tables を読むための Store 境界です。
 *
 * route/usecase は v2 tables を正本として扱い、organization 固有の表現は presenter 側で組み立てます。
 */
export type ReserveAppBillingStore = {
  selectSummary(organizationId: string): Promise<ReserveAppBillingSummaryRow>;

  hasStartedPremiumTrial(input: { organizationId: string }): Promise<boolean>;

  updateStripeCustomerId(input: {
    organizationId: string;
    stripeCustomerId: string;
  }): Promise<void>;

  startPremiumTrial(input: StartReserveAppPremiumTrialInput): Promise<{
    trialStartedAt: Date;
    trialEndsAt: Date;
  }>;

  applyTrialCompletion(input: { organizationId: string }): Promise<TrialCompletionResult>;

  readOwnerBillingHistory(input: {
    organizationId: string;
  }): Promise<ReserveAppBillingHistoryResult>;

  readInvoicePaymentEvents(input: {
    organizationId: string;
  }): Promise<ReserveAppBillingInvoiceEvent[]>;

  readDocumentReferences(input: {
    organizationId: string;
  }): Promise<ReserveAppBillingDocumentReferences>;

  readObservationSnapshot(input: {
    organizationId: string;
  }): Promise<ReserveAppBillingObservationSnapshot>;

  appendAuditEvent(input: AppendReserveAppBillingAuditEventInput): Promise<void>;

  appendSignal(input: AppendReserveAppBillingSignalInput): Promise<void>;

  appendResolvedSignalIfNeeded(input: AppendResolvedReserveAppBillingSignalInput): Promise<void>;

  readInternalInspection(input: { organizationId: string }): Promise<InternalBillingInspection>;
};
