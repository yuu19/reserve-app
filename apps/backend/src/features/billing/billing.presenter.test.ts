import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingApiSummaryResponse } from '@repo/billing-types';
import type { AuthRuntimeEnv } from '../../auth-runtime.js';
import type { ReserveAppBillingStore } from './billing.store.js';
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
  }) as unknown as ReserveAppBillingStore;

describe('課金プレゼンター', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('オーナーにはオーナー限定の履歴・ドキュメント・請求書支払いイベントを含める', async () => {
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

  it('Billing API shadow が disabled でも既存の契約判定を変えない', async () => {
    const store = createStore();

    const result = await readOrganizationBillingSummaryPayload({
      store,
      env,
      organizationId: 'organization-1',
      role: 'owner',
      billingApiShadow: {
        clientResolution: {
          enabled: false,
          disabledReason: 'disabled_by_flag',
        },
        subject: {
          organizationId: 'organization-1',
          organizationName: '予約テスト組織',
          organizationSlug: 'reserve-test',
          billingEmail: 'owner@example.com',
        },
      },
    });

    expect(result.premiumEligible).toBe(true);
    expect(result.entitlementState).toBe('premium_enabled');
    expect(result.billingApiShadow).toMatchObject({
      status: 'disabled',
      disabledReason: 'disabled_by_flag',
      legacy: {
        planCode: 'premium',
        subscriptionStatus: 'active',
        entitlementState: 'premium_enabled',
        premiumEligible: true,
      },
      differences: [],
    });
  });

  it('Billing API summary が有効な場合は契約状態と entitlement を Billing API から返す', async () => {
    const store = createStore();
    vi.mocked(store.selectSummary).mockResolvedValue({
      ...billing,
      planCode: 'free',
      billingInterval: null,
      subscriptionStatus: 'free',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
    });
    const billingApiSummary = {
      subject: {
        appId: 'reserve',
        subjectType: 'organization',
        subjectId: 'organization-1',
        status: 'active',
        displayName: '予約テスト組織',
        billingEmail: 'owner@example.com',
        billingName: '予約テスト組織',
        billingContacts: [],
        metadata: {},
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      },
      account: {
        id: 'billing-account-1',
        provider: 'stripe',
        providerCustomerId: 'cus_billing_api',
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      },
      subscription: {
        id: 'billing-subscription-1',
        provider: 'stripe',
        providerSubscriptionId: 'sub_billing_api',
        planCode: 'premium',
        priceCode: 'premium_monthly',
        providerPriceId: 'price_monthly',
        priceResolution: 'known',
        interval: 'month',
        status: 'active',
        currentPeriodStart: '2026-05-21T00:00:00.000Z',
        currentPeriodEnd: '2026-06-21T00:00:00.000Z',
        trialStart: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      },
      entitlements: {
        appId: 'reserve',
        subjectType: 'organization',
        subjectId: 'organization-1',
        planCode: 'premium',
        status: 'active',
        priceResolution: 'known',
        features: {
          'organization.premium': true,
          'store.multiple': true,
        },
        entitlements: [],
        syncedAt: '2026-05-21T00:00:00.000Z',
        evaluatedAt: '2026-05-21T00:00:00.000Z',
        timeSource: 'server',
        maxStaleSeconds: 300,
      },
      provider: {
        stripeConfigured: true,
        stripeWebhookConfigured: true,
      },
    } satisfies BillingApiSummaryResponse;
    const summaryClient = {
      syncSubject: vi.fn(async () => billingApiSummary),
      readSummary: vi.fn(async () => billingApiSummary),
    };

    const result = await readOrganizationBillingSummaryPayload({
      store,
      env,
      organizationId: 'organization-1',
      role: 'owner',
      billingApiSummary: {
        clientResolution: {
          enabled: true,
          client: summaryClient,
        },
        subject: {
          organizationId: 'organization-1',
          organizationName: '予約テスト組織',
          organizationSlug: 'reserve-test',
          billingEmail: 'owner@example.com',
        },
      },
    });

    expect(summaryClient.syncSubject).toHaveBeenCalled();
    expect(summaryClient.readSummary).toHaveBeenCalledWith({
      subjectType: 'organization',
      subjectId: 'organization-1',
    });
    expect(result.planCode).toBe('premium');
    expect(result.billingInterval).toBe('month');
    expect(result.subscriptionStatus).toBe('active');
    expect(result.premiumEligible).toBe(true);
    expect(result.entitlementState).toBe('premium_enabled');
    expect(result.paymentDocuments).toMatchObject({
      stripeCustomerId: 'cus_billing_api',
      stripeSubscriptionId: 'sub_billing_api',
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
