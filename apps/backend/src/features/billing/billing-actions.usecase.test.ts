import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingProvider } from '@repo/saas-billing-core';
import type { BillingApiSummaryResponse } from '@repo/billing-types';
import type { AuthRuntimeEnv } from '../../auth-runtime.js';
import type { OrganizationBillingOperationAttempt } from '../../domain/billing/organization-billing-operations.js';
import type { BillingRouteContext } from './billing.route-context.js';
import {
  completeTrialLifecycle,
  createSetupCheckoutHandoff,
  createSubscriptionCheckoutHandoff,
  createSubscriptionUpdatePortalHandoff,
  readOrganizationBillingAddonItems,
  startTrialSubscription,
  updateOrganizationBillingAddonItems,
} from './billing-actions.usecase.js';
import type { ReserveAppBillingStore } from './billing.store.js';
import type { BillingOperationStore } from './billing-operation.store.js';

const env = {
  WEB_BASE_URL: 'https://reserve.test',
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_PREMIUM_MONTHLY_PRICE_ID: 'price_monthly',
  STRIPE_PREMIUM_YEARLY_PRICE_ID: 'price_yearly',
  BILLING_API_ACTIONS_ENABLED: 'true',
  BILLING_API_BASE_URL: 'https://billing.test',
  BILLING_API_KEY: 'billing-api-key',
} as AuthRuntimeEnv;

const baseAttempt = {
  id: 'attempt-1',
  organizationId: 'organization-1',
  purpose: 'paid_checkout',
  billingInterval: 'month',
  state: 'processing',
  handoffUrl: null,
  handoffExpiresAt: null,
  provider: 'stripe',
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripeCheckoutSessionId: null,
  stripePortalSessionId: null,
  reuseKey: null,
  idempotencyKey: 'operation:key:1',
  failureReason: null,
  createdByUserId: 'user-1',
  createdAt: new Date('2026-05-21T00:00:00.000Z'),
  updatedAt: new Date('2026-05-21T00:00:00.000Z'),
} satisfies OrganizationBillingOperationAttempt;

const freeBilling = {
  planCode: 'free',
  billingInterval: null,
  subscriptionStatus: 'free',
  cancelAtPeriodEnd: false,
  trialStartedAt: null,
  trialEndedAt: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  paymentIssueStartedAt: null,
  pastDueGraceEndsAt: null,
  billingProfileReadiness: 'not_required',
  billingProfileNextAction: null,
  billingProfileCheckedAt: null,
  lastReconciledAt: null,
  lastReconciliationReason: null,
  stripeCustomerId: 'cus_free',
  stripeSubscriptionId: null,
  stripePriceId: null,
};

const trialBilling = {
  ...freeBilling,
  planCode: 'premium',
  billingInterval: 'month',
  subscriptionStatus: 'trialing',
  currentPeriodEnd: new Date('2026-05-28T00:00:00.000Z'),
  stripeCustomerId: 'cus_trial',
  stripeSubscriptionId: 'sub_trial',
  stripePriceId: 'price_monthly',
};

const paidBilling = {
  ...trialBilling,
  subscriptionStatus: 'active',
  stripeCustomerId: 'cus_paid',
  stripeSubscriptionId: 'sub_paid',
};

const buildBillingApiSummary = ({
  billing = freeBilling,
  providerConfigured = true,
}: {
  billing?: typeof freeBilling;
  providerConfigured?: boolean;
} = {}): BillingApiSummaryResponse => ({
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
    providerCustomerId: billing.stripeCustomerId,
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
  },
  subscription:
    billing.planCode === 'premium'
      ? {
          id: 'billing-subscription-1',
          provider: 'stripe',
          providerSubscriptionId: billing.stripeSubscriptionId,
          planCode: 'premium',
          priceCode: 'premium_monthly',
          providerPriceId: billing.stripePriceId,
          priceResolution: 'known',
          interval: billing.billingInterval,
          status: billing.subscriptionStatus,
          currentPeriodStart: null,
          currentPeriodEnd:
            billing.currentPeriodEnd instanceof Date
              ? billing.currentPeriodEnd.toISOString()
              : null,
          trialStart: null,
          trialEnd:
            billing.subscriptionStatus === 'trialing' && billing.currentPeriodEnd instanceof Date
              ? billing.currentPeriodEnd.toISOString()
              : null,
          cancelAtPeriodEnd: false,
          createdAt: '2026-05-21T00:00:00.000Z',
          updatedAt: '2026-05-21T00:00:00.000Z',
        }
      : null,
  entitlements: {
    appId: 'reserve',
    subjectType: 'organization',
    subjectId: 'organization-1',
    planCode: billing.planCode,
    status: billing.subscriptionStatus,
    priceResolution: billing.planCode === 'premium' ? 'known' : 'not_applicable',
    features:
      billing.planCode === 'premium'
        ? {
            'organization.premium': true,
            'store.multiple': true,
            'staff.invite': true,
          }
        : {},
    entitlements: [],
    syncedAt: '2026-05-21T00:00:00.000Z',
    evaluatedAt: '2026-05-21T00:00:00.000Z',
    timeSource: 'server',
    maxStaleSeconds: 300,
  },
  provider: {
    stripeConfigured: providerConfigured,
    stripeWebhookConfigured: providerConfigured,
  },
});

const snapshot = {
  planCode: 'free',
  planState: 'free',
  subscriptionStatus: 'free',
  paymentMethodStatus: 'not_started',
  entitlementState: 'free_only',
  paidTier: null,
  billingInterval: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripePriceId: null,
};

const createStore = (billing: typeof freeBilling = freeBilling) =>
  ({
    selectSummary: vi.fn(async () => billing),
    hasStartedPremiumTrial: vi.fn(async () => false),
    updateStripeCustomerId: vi.fn(async () => undefined),
    startPremiumTrial: vi.fn(async () => ({
      trialStartedAt: new Date('2026-05-21T00:00:00.000Z'),
      trialEndsAt: new Date('2026-05-28T00:00:00.000Z'),
    })),
    applyTrialCompletion: vi.fn(async () => ({
      ok: true,
      message: 'Trial completed.',
    })),
    readOwnerBillingHistory: vi.fn(async () => ({ entries: [] })),
    readInvoicePaymentEvents: vi.fn(async () => []),
    readDocumentReferences: vi.fn(async () => []),
    readObservationSnapshot: vi.fn(async () => snapshot),
    appendAuditEvent: vi.fn(async () => undefined),
    appendSignal: vi.fn(async () => undefined),
    appendResolvedSignalIfNeeded: vi.fn(async () => undefined),
    readInternalInspection: vi.fn(),
  }) as unknown as ReserveAppBillingStore;

const createOperationStore = (attempt: OrganizationBillingOperationAttempt = baseAttempt) =>
  ({
    createAttempt: vi.fn(async () => ({
      attempt,
      reused: false,
    })),
    markSucceeded: vi.fn(async (input) => ({
      ...attempt,
      state: 'succeeded',
      handoffUrl: input.handoffUrl ?? null,
      handoffExpiresAt: input.handoffExpiresAt ?? null,
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? null,
      stripePortalSessionId: input.stripePortalSessionId ?? null,
    })),
    markFailed: vi.fn(async () => ({
      ...attempt,
      state: 'failed',
    })),
  }) satisfies BillingOperationStore;

const createProvider = (overrides: Partial<BillingProvider> = {}) =>
  ({
    createCustomer: vi.fn(async () => ({ id: 'cus_created' })),
    createSubscriptionCheckoutSession: vi.fn(async () => ({
      id: 'cs_checkout',
      url: 'https://stripe.test/checkout',
    })),
    createTrialSubscription: vi.fn(async () => ({
      id: 'sub_trial',
      status: 'trialing',
      priceId: 'price_monthly',
      currentPeriodStart: new Date('2026-05-21T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-05-28T00:00:00.000Z'),
    })),
    createSetupCheckoutSession: vi.fn(async () => ({
      id: 'cs_setup',
      url: 'https://stripe.test/setup',
    })),
    createBillingPortalSession: vi.fn(async () => ({
      id: 'bps_portal',
      url: 'https://stripe.test/portal',
    })),
    retrieveSubscription: vi.fn(),
    retrieveCustomerSummary: vi.fn(),
    ...overrides,
  }) as BillingProvider;

const createBillingApiFetch = ({
  handoffUrl,
  handoffStatus = 200,
  handoffBody,
  summary,
  summaries,
  addonItems = {
    appId: 'reserve',
    subjectType: 'organization',
    subjectId: 'organization-1',
    items: [],
    syncedAt: '2026-05-21T00:00:00.000Z',
  },
}: {
  handoffUrl: string;
  handoffStatus?: number;
  handoffBody?: unknown;
  summary?: BillingApiSummaryResponse;
  summaries?: BillingApiSummaryResponse[];
  addonItems?: unknown;
}) => {
  const summaryQueue = [...(summaries ?? [])];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT' && !String(input).includes('/addon-items/')) {
      return new Response(JSON.stringify({ synced: true }), { status: 200 });
    }
    if (init?.method === 'GET' && String(input).endsWith('/summary')) {
      return new Response(
        JSON.stringify(summaryQueue.shift() ?? summary ?? buildBillingApiSummary()),
        {
          status: 200,
        },
      );
    }
    if (init?.method === 'GET' && String(input).endsWith('/addon-items')) {
      return new Response(JSON.stringify(addonItems), { status: 200 });
    }
    if (init?.method === 'PATCH' && String(input).endsWith('/addon-items')) {
      return new Response(
        JSON.stringify(
          handoffBody ?? {
            summary: summary ?? buildBillingApiSummary({ billing: paidBilling }),
            addonItems,
          },
        ),
        {
          status: handoffStatus,
        },
      );
    }

    return new Response(
      JSON.stringify(
        handoffBody ?? {
          status: 'processing',
          message: 'Billing API handoff is ready.',
          url: handoffUrl,
          operationAttemptId: 'billing-api-attempt-1',
          reused: false,
        },
      ),
      { status: handoffStatus },
    );
  });
};

const createContext = ({
  billing = freeBilling,
  role = 'owner',
  provider = createProvider(),
  envOverride = {},
  organizationSubject = {
    id: 'organization-1',
    name: '予約テスト組織',
    slug: 'reserve-test',
  },
}: {
  billing?: typeof freeBilling;
  role?: 'owner' | 'admin' | 'member' | null;
  provider?: BillingProvider;
  envOverride?: Partial<AuthRuntimeEnv>;
  organizationSubject?: {
    id: string;
    name: string;
    slug: string | null;
  } | null;
} = {}) => {
  const store = createStore(billing);
  const operationStore = createOperationStore();
  const readOrganizationSubject = vi.fn(async () => organizationSubject);
  const getSessionIdentity = vi.fn(async () => ({
    userId: 'user-1',
    email: 'owner@example.com',
    emailVerified: true,
    activeOrganizationId: 'organization-1',
  }));
  const currentEnv = {
    ...env,
    ...envOverride,
  };

  return {
    ctx: {
      auth: null,
      database: null,
      env: currentEnv,
      store,
      operationStore,
      createProvider: vi.fn(() => provider),
      getSessionIdentity,
      resolveOrganizationId: vi.fn(
        ({ requestedOrganizationId, activeOrganizationId }) =>
          requestedOrganizationId ?? activeOrganizationId,
      ),
      readOrganizationMembershipRole: vi.fn(async () => role),
      readOrganizationSubject,
      resolveE2eStripeTestClockId: vi.fn(() => null),
    } as unknown as BillingRouteContext,
    store,
    operationStore,
    provider,
    readOrganizationSubject,
    getSessionIdentity,
  };
};

describe('課金アクションユースケース', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Billing API Checkout ハンドオフ作成時に checkout 操作を成功として記録する', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: 'https://billing.test/checkout',
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider();
    const { ctx, operationStore } = createContext({ provider });

    const result = await createSubscriptionCheckoutHandoff({
      ctx,
      body: { organizationId: 'organization-1', billingInterval: 'month' },
      headers: new Headers(),
    });

    expect(result.status).toBe(200);
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(provider.createSubscriptionCheckoutSession).not.toHaveBeenCalled();
    expect(operationStore.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'attempt-1',
        handoffUrl: 'https://billing.test/checkout',
      }),
    );
    expect(operationStore.markFailed).not.toHaveBeenCalled();
  });

  it('Billing API action が無効なら legacy Stripe に fallback せず checkout を失敗にする', async () => {
    const provider = createProvider();
    const { ctx, operationStore } = createContext({
      provider,
      envOverride: {
        BILLING_API_ACTIONS_ENABLED: 'false',
      },
    });

    const result = await createSubscriptionCheckoutHandoff({
      ctx,
      body: { organizationId: 'organization-1', billingInterval: 'month' },
      headers: new Headers(),
    });

    expect(result.status).toBe(422);
    expect(result.body.message).toBe('Billing API actions are disabled.');
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(provider.createSubscriptionCheckoutSession).not.toHaveBeenCalled();
    expect(operationStore.createAttempt).not.toHaveBeenCalled();
  });

  it('Billing API action flag が有効なら checkout は subject sync 後に Billing API 経由で作成する', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: 'https://billing.test/checkout',
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider();
    const { ctx, operationStore } = createContext({
      provider,
      envOverride: {
        BILLING_API_ACTIONS_ENABLED: 'true',
        BILLING_API_BASE_URL: 'https://billing.test',
        BILLING_API_KEY: 'billing-api-key',
      },
    });

    const result = await createSubscriptionCheckoutHandoff({
      ctx,
      body: { organizationId: 'organization-1', billingInterval: 'month' },
      headers: new Headers(),
    });

    expect(result.status).toBe(200);
    expect(result.body.url).toBe('https://billing.test/checkout');
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(provider.createSubscriptionCheckoutSession).not.toHaveBeenCalled();
    expect(operationStore.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'attempt-1',
        handoffUrl: 'https://billing.test/checkout',
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT' });
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get('authorization')).toBe(
      'Bearer billing-api-key',
    );
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get('idempotency-key')).toBe(
      'reserve-action-sync:organization-1:paid-checkout-precondition',
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      displayName: '予約テスト組織',
      billingEmail: 'owner@example.com',
      metadata: {
        source: 'reserve-app-backend-action',
        organizationSlug: 'reserve-test',
      },
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/summary',
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/checkout-sessions',
    );
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toMatchObject({
      actor: {
        type: 'user',
        id: 'user-1',
        email: 'owner@example.com',
      },
      planCode: 'premium',
      interval: 'month',
      returnUrlKey: 'default',
    });
    expect(String(fetchMock.mock.calls[3]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/summary',
    );
  });

  it('Billing API checkout 失敗時は legacy Stripe に fallback せず local attempt を失敗にする', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: 'https://billing.test/checkout',
      handoffStatus: 503,
      handoffBody: {
        error: {
          code: 'provider_not_configured',
          message: 'Billing API provider is not configured.',
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider();
    const { ctx, operationStore } = createContext({
      provider,
      envOverride: {
        BILLING_API_ACTIONS_ENABLED: 'true',
        BILLING_API_BASE_URL: 'https://billing.test',
        BILLING_API_KEY: 'billing-api-key',
      },
    });

    const result = await createSubscriptionCheckoutHandoff({
      ctx,
      body: { organizationId: 'organization-1', billingInterval: 'month' },
      headers: new Headers(),
    });

    expect(result.status).toBe(500);
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(provider.createSubscriptionCheckoutSession).not.toHaveBeenCalled();
    expect(operationStore.markFailed).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      state: 'failed',
      failureReason: 'Billing API provider is not configured.',
    });
  });

  it('Billing API checkout が failed を返した場合も legacy Stripe に fallback せず local attempt を失敗にする', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: 'https://billing.test/checkout',
      handoffBody: {
        status: 'failed',
        message: 'Billing API could not create a checkout session.',
        url: null,
        operationAttemptId: 'billing-api-attempt-1',
        reused: false,
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider();
    const { ctx, operationStore } = createContext({
      provider,
      envOverride: {
        BILLING_API_ACTIONS_ENABLED: 'true',
        BILLING_API_BASE_URL: 'https://billing.test',
        BILLING_API_KEY: 'billing-api-key',
      },
    });

    const result = await createSubscriptionCheckoutHandoff({
      ctx,
      body: { organizationId: 'organization-1', billingInterval: 'month' },
      headers: new Headers(),
    });

    expect(result.status).toBe(500);
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(provider.createSubscriptionCheckoutSession).not.toHaveBeenCalled();
    expect(operationStore.markFailed).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      state: 'failed',
      failureReason: 'Billing API could not create a checkout session.',
    });
  });

  it('Billing API action flag が有効なら trial start は Billing API 経由で実行する', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: '',
      summaries: [
        buildBillingApiSummary(),
        buildBillingApiSummary({
          billing: {
            ...trialBilling,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
          },
        }),
      ],
      handoffBody: {
        status: 'succeeded',
        message: 'Started trial.',
        url: null,
        operationAttemptId: null,
        reused: false,
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider();
    const { ctx, store, operationStore } = createContext({ provider });

    const result = await startTrialSubscription({
      ctx,
      body: { organizationId: 'organization-1' },
      headers: new Headers(),
    });

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('succeeded');
    expect(result.body.billing).toMatchObject({
      planCode: 'premium',
      planState: 'premium_trial',
      subscriptionStatus: 'trialing',
      premiumEligible: true,
    });
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(provider.createTrialSubscription).not.toHaveBeenCalled();
    expect(store.startPremiumTrial).not.toHaveBeenCalled();
    expect(operationStore.markSucceeded).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
    });
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/trial',
    );
  });

  it('Billing API trial start 失敗時は local trial mutation に fallback しない', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: '',
      handoffStatus: 503,
      handoffBody: {
        error: {
          code: 'internal_error',
          message: 'Billing API trial failed.',
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider();
    const { ctx, store, operationStore } = createContext({ provider });

    const result = await startTrialSubscription({
      ctx,
      body: { organizationId: 'organization-1' },
      headers: new Headers(),
    });

    expect(result.status).toBe(500);
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(provider.createTrialSubscription).not.toHaveBeenCalled();
    expect(store.startPremiumTrial).not.toHaveBeenCalled();
    expect(operationStore.markFailed).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      state: 'failed',
      failureReason: 'Billing API trial failed.',
    });
  });

  it('Billing API setup ハンドオフ作成失敗時に setup 操作を失敗として記録する', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: 'https://billing.test/setup',
      handoffStatus: 503,
      summary: buildBillingApiSummary({ billing: trialBilling }),
      handoffBody: {
        error: {
          code: 'provider_not_configured',
          message: 'Billing API setup failed.',
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider();
    const { ctx, operationStore } = createContext({ billing: trialBilling, provider });

    const result = await createSetupCheckoutHandoff({
      ctx,
      body: { organizationId: 'organization-1' },
      headers: new Headers(),
    });

    expect(result.status).toBe(500);
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(provider.createSetupCheckoutSession).not.toHaveBeenCalled();
    expect(operationStore.markFailed).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      state: 'failed',
      failureReason: 'Billing API setup failed.',
    });
  });

  it('Billing API action flag が有効なら setup は Billing API 経由で作成する', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: 'https://billing.test/setup',
      summary: buildBillingApiSummary({ billing: trialBilling }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider();
    const { ctx, operationStore } = createContext({
      billing: trialBilling,
      provider,
      envOverride: {
        BILLING_API_ACTIONS_ENABLED: 'true',
        BILLING_API_BASE_URL: 'https://billing.test',
        BILLING_API_KEY: 'billing-api-key',
      },
    });

    const result = await createSetupCheckoutHandoff({
      ctx,
      body: { organizationId: 'organization-1' },
      headers: new Headers(),
    });

    expect(result.status).toBe(200);
    expect(result.body.url).toBe('https://billing.test/setup');
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(provider.createSetupCheckoutSession).not.toHaveBeenCalled();
    expect(operationStore.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'attempt-1',
        handoffUrl: 'https://billing.test/setup',
      }),
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/payment-method-setup-sessions',
    );
  });

  it('Billing API portal ハンドオフ作成失敗時に portal 操作を失敗として記録する', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: 'https://billing.test/portal',
      handoffStatus: 503,
      summary: buildBillingApiSummary({ billing: paidBilling }),
      handoffBody: {
        error: {
          code: 'provider_not_configured',
          message: 'Billing API portal failed.',
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider();
    const { ctx, operationStore } = createContext({ billing: paidBilling, provider });

    const result = await createSubscriptionUpdatePortalHandoff({
      ctx,
      body: { organizationId: 'organization-1' },
      headers: new Headers(),
    });

    expect(result.status).toBe(500);
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(provider.createBillingPortalSession).not.toHaveBeenCalled();
    expect(operationStore.markFailed).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      state: 'failed',
      failureReason: 'Billing API portal failed.',
    });
  });

  it('Billing API action flag が有効なら portal は Billing API 経由で作成する', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: 'https://billing.test/portal',
      summary: buildBillingApiSummary({ billing: paidBilling }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider();
    const { ctx, operationStore } = createContext({
      billing: paidBilling,
      provider,
      envOverride: {
        BILLING_API_ACTIONS_ENABLED: 'true',
        BILLING_API_BASE_URL: 'https://billing.test',
        BILLING_API_KEY: 'billing-api-key',
      },
    });

    const result = await createSubscriptionUpdatePortalHandoff({
      ctx,
      body: { organizationId: 'organization-1' },
      headers: new Headers(),
    });

    expect(result.status).toBe(200);
    expect(result.body.url).toBe('https://billing.test/portal');
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(provider.createBillingPortalSession).not.toHaveBeenCalled();
    expect(operationStore.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'attempt-1',
        handoffUrl: 'https://billing.test/portal',
      }),
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/billing-portal-sessions',
    );
  });

  it('Billing API action flag が有効なら subject 同期後に addon を一括更新する', async () => {
    const updatedSummary = buildBillingApiSummary({ billing: paidBilling });
    updatedSummary.entitlements.features = {
      ...updatedSummary.entitlements.features,
      staffLimit: 12,
    };
    const fetchMock = createBillingApiFetch({
      handoffUrl: '',
      summary: updatedSummary,
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider();
    const { ctx, operationStore } = createContext({ billing: paidBilling, provider });

    const result = await updateOrganizationBillingAddonItems({
      ctx,
      body: {
        organizationId: 'organization-1',
        items: [
          { addonCode: 'staff_seat', quantity: 2 },
          { addonCode: 'shop_slot', quantity: 0 },
        ],
      },
      headers: new Headers(),
      idempotencyKey: 'addon-update-operation-1',
    });

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('succeeded');
    expect(result.body.billing?.premiumEligible).toBe(true);
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(operationStore.createAttempt).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT' });
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get('idempotency-key')).toMatch(
      /^reserve-addon-items-sync:organization-1:[a-f0-9]{16}$/,
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/addon-items',
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH' });
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Headers).get('idempotency-key')).toMatch(
      /^reserve-addon-items:organization-1:user-1:[a-f0-9]{32}$/,
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(requestBody).toMatchObject({
      items: [
        { addonCode: 'shop_slot', quantity: 0 },
        { addonCode: 'staff_seat', quantity: 2 },
      ],
    });
    expect(requestBody.actor).toEqual({ type: 'user', id: 'user-1' });
  });

  it('addon 再送は subject metadata 変更後も新しい sync key と同じ PATCH を送る', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: '',
      summary: buildBillingApiSummary({ billing: paidBilling }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { ctx, getSessionIdentity, readOrganizationSubject } = createContext({
      billing: paidBilling,
    });
    const items = [
      { addonCode: 'staff_seat' as const, quantity: 2 },
      { addonCode: 'shop_slot' as const, quantity: 0 },
    ];

    for (const [index, orderedItems] of [items, items.slice().reverse()].entries()) {
      if (index === 1) {
        getSessionIdentity.mockResolvedValueOnce({
          userId: 'user-1',
          email: 'renamed-owner@example.com',
          emailVerified: true,
          activeOrganizationId: 'organization-1',
        });
        readOrganizationSubject.mockResolvedValueOnce({
          id: 'organization-1',
          name: '変更後の予約テスト組織',
          slug: 'reserve-test-renamed',
        });
      }
      await updateOrganizationBillingAddonItems({
        ctx,
        body: {
          organizationId: 'organization-1',
          items: orderedItems,
        },
        headers: new Headers(),
        idempotencyKey: 'addon-update-retry-1',
      });
    }

    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patchCalls).toHaveLength(2);
    const idempotencyKeys = patchCalls.map(([, init]) =>
      (init?.headers as Headers).get('idempotency-key'),
    );
    expect(idempotencyKeys[0]).toMatch(/^reserve-addon-items:organization-1:user-1:[a-f0-9]{32}$/);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    expect(patchCalls[0]?.[1]?.body).toBe(patchCalls[1]?.[1]?.body);
    const syncCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(syncCalls).toHaveLength(2);
    const syncKeys = syncCalls.map(([, init]) => (init?.headers as Headers).get('idempotency-key'));
    expect(syncKeys).toEqual([
      expect.stringMatching(/^reserve-addon-items-sync:organization-1:[a-f0-9]{16}$/),
      expect.stringMatching(/^reserve-addon-items-sync:organization-1:[a-f0-9]{16}$/),
    ]);
    expect(syncKeys[1]).not.toBe(syncKeys[0]);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual([
      'PUT',
      'PATCH',
      'GET',
      'PUT',
      'PATCH',
      'GET',
    ]);
  });

  it('addon 数量を以前の値へ戻す別操作には異なる冪等性キーを送る', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: '',
      summary: buildBillingApiSummary({ billing: paidBilling }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { ctx } = createContext({ billing: paidBilling });

    for (const [quantity, idempotencyKey] of [
      [2, 'addon-update-to-2-first'],
      [3, 'addon-update-to-3'],
      [2, 'addon-update-to-2-again'],
    ] as const) {
      await updateOrganizationBillingAddonItems({
        ctx,
        body: {
          organizationId: 'organization-1',
          items: [{ addonCode: 'staff_seat', quantity }],
        },
        headers: new Headers(),
        idempotencyKey,
      });
    }

    const patchKeys = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'PATCH')
      .map(([, init]) => (init?.headers as Headers).get('idempotency-key'));
    expect(patchKeys).toHaveLength(3);
    expect(new Set(patchKeys).size).toBe(3);
    expect(patchKeys[2]).not.toBe(patchKeys[0]);
  });

  it('owner は subscription state にかかわらず addon 一覧を取得できる', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: '',
      addonItems: {
        appId: 'reserve',
        subjectType: 'organization',
        subjectId: 'organization-1',
        items: [
          {
            addonCode: 'staff_seat',
            quantity: 2,
            status: 'active',
            pendingQuantity: 0,
            pendingEffectiveAt: '2026-06-21T00:00:00.000Z',
          },
        ],
        syncedAt: '2026-05-21T00:00:00.000Z',
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const { ctx } = createContext({
      billing: trialBilling,
      envOverride: { BILLING_API_SUMMARY_ENABLED: 'true' },
    });

    const result = await readOrganizationBillingAddonItems({
      ctx,
      query: { organizationId: 'organization-1' },
      headers: new Headers(),
    });

    expect(result).toEqual({
      status: 200,
      body: {
        organizationId: 'organization-1',
        items: [
          {
            addonCode: 'staff_seat',
            quantity: 2,
            status: 'active',
            pendingQuantity: 0,
            pendingEffectiveAt: '2026-06-21T00:00:00.000Z',
          },
        ],
        syncedAt: '2026-05-21T00:00:00.000Z',
      },
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/addon-items',
    );
  });

  it('addon 一覧取得は subject metadata の変更時に別の sync idempotency key を使う', async () => {
    const fetchMock = createBillingApiFetch({ handoffUrl: '' });
    vi.stubGlobal('fetch', fetchMock);
    const { ctx, readOrganizationSubject } = createContext({
      envOverride: { BILLING_API_SUMMARY_ENABLED: 'true' },
    });

    const first = await readOrganizationBillingAddonItems({
      ctx,
      query: { organizationId: 'organization-1' },
      headers: new Headers(),
    });
    readOrganizationSubject.mockResolvedValueOnce({
      id: 'organization-1',
      name: '変更後の予約テスト組織',
      slug: 'reserve-test-renamed',
    });
    const second = await readOrganizationBillingAddonItems({
      ctx,
      query: { organizationId: 'organization-1' },
      headers: new Headers(),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const syncKeys = fetchMock.mock.calls
      .filter(
        ([input, init]) =>
          init?.method === 'PUT' && String(input).endsWith('/subjects/organization/organization-1'),
      )
      .map(([, init]) => new Headers(init?.headers).get('idempotency-key'));
    expect(syncKeys).toEqual([
      expect.stringMatching(/^reserve-addon-items-read-sync:organization-1:[a-f0-9]{16}$/),
      expect.stringMatching(/^reserve-addon-items-read-sync:organization-1:[a-f0-9]{16}$/),
    ]);
    expect(syncKeys[1]).not.toBe(syncKeys[0]);
  });

  it('Billing API による active paid premium 判定結果を伝播する', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: '',
      summary: buildBillingApiSummary({ billing: trialBilling }),
      handoffStatus: 409,
      handoffBody: {
        error: {
          code: 'bad_request',
          message: 'Addon updates require an active paid premium subscription.',
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const { ctx, operationStore } = createContext({ billing: trialBilling });

    const result = await updateOrganizationBillingAddonItems({
      ctx,
      body: {
        organizationId: 'organization-1',
        items: [{ addonCode: 'staff_seat', quantity: 2 }],
      },
      headers: new Headers(),
      idempotencyKey: 'addon-update-inactive-subscription',
    });

    expect(result.status).toBe(409);
    expect(result.body.status).toBe('conflict');
    expect(operationStore.createAttempt).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT' });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/addon-items',
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH' });
  });

  it('Billing API addon 一括更新の 400 は backend で 500 に潰さない', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: '',
      summary: buildBillingApiSummary({ billing: paidBilling }),
      handoffStatus: 400,
      handoffBody: {
        error: {
          code: 'not_implemented',
          message: 'Addon update request is invalid.',
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const { ctx } = createContext({ billing: paidBilling });

    const result = await updateOrganizationBillingAddonItems({
      ctx,
      body: {
        organizationId: 'organization-1',
        items: [{ addonCode: 'staff_seat', quantity: 1 }],
      },
      headers: new Headers(),
      idempotencyKey: 'addon-update-invalid-request',
    });

    expect(result.status).toBe(400);
    expect(result.body.status).toBe('conflict');
    expect(result.body.message).toBe('Addon update request is invalid.');
  });

  it('Billing API action flag が有効なら trial complete は Billing API 経由で実行する', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: '',
      summary: buildBillingApiSummary({ billing: trialBilling }),
      handoffBody: {
        status: 'succeeded',
        message: 'Trial completed and subject returned to free.',
        url: null,
        operationAttemptId: null,
        reused: false,
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const { ctx, store, operationStore } = createContext({ billing: trialBilling });

    const result = await completeTrialLifecycle({
      ctx,
      body: { organizationId: 'organization-1' },
      headers: new Headers(),
    });

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('succeeded');
    expect(store.applyTrialCompletion).not.toHaveBeenCalled();
    expect(operationStore.createAttempt).not.toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/trial/complete',
    );
    expect((fetchMock.mock.calls[2]?.[1]?.headers as Headers).get('idempotency-key')).toBe(
      'reserve-trial-complete:organization-1:user-1',
    );
  });

  it('非オーナーの課金アクションでは操作取得前に 403 を返す', async () => {
    const actions = [
      () =>
        createSubscriptionCheckoutHandoff({
          ctx,
          body: { organizationId: 'organization-1', billingInterval: 'month' },
          headers: new Headers(),
        }),
      () =>
        startTrialSubscription({
          ctx,
          body: { organizationId: 'organization-1' },
          headers: new Headers(),
        }),
      () =>
        createSetupCheckoutHandoff({
          ctx,
          body: { organizationId: 'organization-1' },
          headers: new Headers(),
        }),
      () =>
        createSubscriptionUpdatePortalHandoff({
          ctx,
          body: { organizationId: 'organization-1' },
          headers: new Headers(),
        }),
      () =>
        updateOrganizationBillingAddonItems({
          ctx,
          body: {
            organizationId: 'organization-1',
            items: [{ addonCode: 'staff_seat', quantity: 2 }],
          },
          headers: new Headers(),
          idempotencyKey: 'addon-update-forbidden-owner',
        }),
      () =>
        completeTrialLifecycle({
          ctx,
          body: { organizationId: 'organization-1' },
          headers: new Headers(),
        }),
    ];
    const { ctx, operationStore } = createContext({ role: 'admin' });

    for (const runAction of actions) {
      await expect(runAction()).resolves.toEqual({
        status: 403,
        body: { message: 'Forbidden' },
      });
    }
    expect(operationStore.createAttempt).not.toHaveBeenCalled();
  });
});
