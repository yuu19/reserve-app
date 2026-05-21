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
  applyOrganizationPremiumTrialCompletion,
  selectOrganizationBillingSummary,
  startOrganizationPremiumTrial,
} from '../../domain/billing/organization-billing.js';

export type OrganizationBillingSummaryRow = Awaited<
  ReturnType<typeof selectOrganizationBillingSummary>
>;
export type StartOrganizationPremiumTrialInput = Omit<
  Parameters<typeof startOrganizationPremiumTrial>[0],
  'database'
>;
export type TrialCompletionResult = Awaited<
  ReturnType<typeof applyOrganizationPremiumTrialCompletion>
>;
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
 * reserve-app の organization billing aggregate を読むための Store 境界です。
 *
 * 汎用 billing store ではなく、現行 organization_billing 系テーブルと周辺 append-only table を
 * usecase から扱うための薄い adapter 契約に限定します。
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
