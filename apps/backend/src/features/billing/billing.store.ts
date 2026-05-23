import type { readInternalBillingInspection } from '../../domain/billing/internal-billing-inspection.js';
import type { buildBillingDocumentReadiness } from '../../domain/billing/organization-billing-documents.js';
import type { readOrganizationOwnerBillingHistory } from '../../domain/billing/organization-billing-history.js';
import type { OrganizationBillingInvoicePaymentEvent } from '../../domain/billing/organization-billing-invoice-events.js';
import type {
  appendOrganizationBillingAuditEvent,
  appendOrganizationBillingSignal,
  appendResolvedBillingSignalIfNeeded,
  readOrganizationBillingObservationSnapshot,
} from '../../domain/billing/organization-billing-observability.js';
import type {
  OrganizationBillingPlanCode,
  OrganizationBillingSubscriptionStatus,
} from '../../domain/billing/organization-billing.js';

export type OrganizationBillingSummaryRow = {
  planCode: OrganizationBillingPlanCode;
  billingInterval: 'month' | 'year' | null;
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
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
export type StartOrganizationPremiumTrialInput = {
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
export type OrganizationBillingHistoryResult = Awaited<
  ReturnType<typeof readOrganizationOwnerBillingHistory>
>;
export type OrganizationBillingDocumentReferences = Parameters<
  typeof buildBillingDocumentReadiness
>[0]['documents'];
export type OrganizationBillingObservationSnapshot = Awaited<
  ReturnType<typeof readOrganizationBillingObservationSnapshot>
>;
export type AppendOrganizationBillingAuditEventInput = Omit<
  Parameters<typeof appendOrganizationBillingAuditEvent>[0],
  'database'
>;
export type AppendOrganizationBillingSignalInput = Omit<
  Parameters<typeof appendOrganizationBillingSignal>[0],
  'database'
>;
export type AppendResolvedBillingSignalInput = Omit<
  Parameters<typeof appendResolvedBillingSignalIfNeeded>[0],
  'database'
>;
export type InternalBillingInspection = Awaited<ReturnType<typeof readInternalBillingInspection>>;

/**
 * reserve-app の billing v2 tables を読むための Store 境界です。
 *
 * route/usecase は v2 tables を正本として扱い、organization 固有の表現は presenter 側で組み立てます。
 */
export type OrganizationBillingStore = {
  selectSummary(organizationId: string): Promise<OrganizationBillingSummaryRow>;

  hasStartedPremiumTrial(input: { organizationId: string }): Promise<boolean>;

  updateStripeCustomerId(input: {
    organizationId: string;
    stripeCustomerId: string;
  }): Promise<void>;

  startPremiumTrial(input: StartOrganizationPremiumTrialInput): Promise<{
    trialStartedAt: Date;
    trialEndsAt: Date;
  }>;

  applyTrialCompletion(input: { organizationId: string }): Promise<TrialCompletionResult>;

  readOwnerBillingHistory(input: {
    organizationId: string;
  }): Promise<OrganizationBillingHistoryResult>;

  readInvoicePaymentEvents(input: {
    organizationId: string;
  }): Promise<OrganizationBillingInvoicePaymentEvent[]>;

  readDocumentReferences(input: {
    organizationId: string;
  }): Promise<OrganizationBillingDocumentReferences>;

  readObservationSnapshot(input: {
    organizationId: string;
  }): Promise<OrganizationBillingObservationSnapshot>;

  appendAuditEvent(input: AppendOrganizationBillingAuditEventInput): Promise<void>;

  appendSignal(input: AppendOrganizationBillingSignalInput): Promise<void>;

  appendResolvedSignalIfNeeded(input: AppendResolvedBillingSignalInput): Promise<void>;

  readInternalInspection(input: { organizationId: string }): Promise<InternalBillingInspection>;
};
