import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthRuntimeEnv } from '../../auth-runtime.js';
import type { OrganizationBillingStore } from './billing.store.js';
import { readOrganizationBillingSummaryPayload } from './billing.presenter.js';

const env = {
  STRIPE_PREMIUM_MONTHLY_PRICE_ID: 'price_monthly',
} as AuthRuntimeEnv;

const billing = {
  planCode: 'premium',
  billingInterval: 'month',
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  trialStartedAt: null,
  trialEndedAt: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  paymentIssueStartedAt: null,
  pastDueGraceEndsAt: null,
  billingProfileReadiness: 'complete',
  billingProfileNextAction: null,
  billingProfileCheckedAt: new Date('2026-05-21T00:00:00.000Z'),
  lastReconciledAt: null,
  lastReconciliationReason: null,
  stripeCustomerId: 'cus_owner',
  stripeSubscriptionId: 'sub_owner',
  stripePriceId: 'price_monthly',
};

const invoicePaymentEvent = {
  id: 'payment-event-1',
  organizationId: 'organization-1',
  stripeEventId: 'evt_1',
  eventType: 'payment_succeeded',
  stripeCustomerId: 'cus_owner',
  stripeSubscriptionId: 'sub_owner',
  stripeInvoiceId: 'in_1',
  stripePaymentIntentId: 'pi_1',
  providerStatus: 'paid',
  ownerFacingStatus: 'succeeded',
  occurredAt: '2026-05-21T00:00:00.000Z',
  createdAt: '2026-05-21T00:00:00.000Z',
} as const;

const documentReference = {
  aggregateRoot: 'billing_account',
  documentKind: 'invoice',
  documentConcepts: ['invoice', 'payment_document', 'provider_document'],
  provider: 'stripe',
  providerDocumentId: 'in_1',
  stripeCustomerId: 'cus_owner',
  stripeSubscriptionId: 'sub_owner',
  hostedInvoiceUrl: 'https://stripe.test/invoice',
  invoicePdfUrl: 'https://stripe.test/invoice.pdf',
  receiptUrl: null,
  availability: 'available',
  ownerFacingStatus: 'available',
} as const;

const createStore = () =>
  ({
    selectSummary: vi.fn(async () => billing),
    hasStartedPremiumTrial: vi.fn(async () => true),
    updateStripeCustomerId: vi.fn(),
    startPremiumTrial: vi.fn(),
    applyTrialCompletion: vi.fn(),
    readOwnerBillingHistory: vi.fn(async () => ({
      entries: [
        {
          id: 'history-1',
          eventType: 'payment_event',
          occurredAt: '2026-05-21T00:00:00.000Z',
          title: '支払いが完了しました',
          summary: 'Premiumプランの支払いが完了しました。',
          billingContext: null,
          tone: 'positive',
        },
      ],
    })),
    readInvoicePaymentEvents: vi.fn(async () => [invoicePaymentEvent]),
    readDocumentReferences: vi.fn(async () => [documentReference]),
    readObservationSnapshot: vi.fn(),
    appendAuditEvent: vi.fn(),
    appendSignal: vi.fn(),
    appendResolvedSignalIfNeeded: vi.fn(),
    readInternalInspection: vi.fn(),
  }) as unknown as OrganizationBillingStore;

describe('billing presenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes owner-only history, documents and invoice payment events for owners', async () => {
    const store = createStore();

    const result = await readOrganizationBillingSummaryPayload({
      store,
      env,
      organizationId: 'organization-1',
      role: 'owner',
    });

    expect(result.history).toHaveLength(1);
    expect(result.paymentDocuments).toMatchObject({
      aggregateRoot: 'billing_account',
      organizationId: 'organization-1',
      ownerAccess: 'owner_only',
      documents: [
        {
          documentKind: 'invoice',
          providerDocumentId: 'in_1',
          ownerFacingStatus: 'available',
        },
      ],
    });
    expect(result.invoicePaymentEvents).toEqual([invoicePaymentEvent]);
    expect(store.readOwnerBillingHistory).toHaveBeenCalledWith({
      organizationId: 'organization-1',
    });
    expect(store.readDocumentReferences).toHaveBeenCalledWith({
      organizationId: 'organization-1',
    });
  });

  it.each(['admin', 'member'] as const)(
    'hides owner-only billing detail for %s role',
    async (role) => {
      const store = createStore();

      const result = await readOrganizationBillingSummaryPayload({
        store,
        env,
        organizationId: 'organization-1',
        role,
      });

      expect(result.history).toBeNull();
      expect(result.paymentDocuments).toBeNull();
      expect(result.invoicePaymentEvents).toEqual([]);
      expect(store.readOwnerBillingHistory).not.toHaveBeenCalled();
      expect(store.readDocumentReferences).not.toHaveBeenCalled();
      expect(store.readInvoicePaymentEvents).toHaveBeenCalledWith({
        organizationId: 'organization-1',
      });
    },
  );
});
