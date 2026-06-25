import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingProvider } from '@repo/saas-billing-core';
import type { AuthRuntimeEnv } from '../../auth-runtime.js';
import type { OrganizationBillingOperationAttempt } from '../../domain/billing/organization-billing-operations.js';
import type { BillingRouteContext } from './billing.route-context.js';
import {
  completeTrialLifecycle,
  createSetupCheckoutHandoff,
  createSubscriptionCheckoutHandoff,
  createSubscriptionUpdatePortalHandoff,
  startTrialSubscription,
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
}: {
  handoffUrl: string;
  handoffStatus?: number;
  handoffBody?: unknown;
}) =>
  vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return new Response(JSON.stringify({ synced: true }), { status: 200 });
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

const createContext = ({
  billing = freeBilling,
  role = 'owner',
  provider = createProvider(),
  envOverride = {},
}: {
  billing?: typeof freeBilling;
  role?: 'owner' | 'admin' | 'member' | null;
  provider?: BillingProvider;
  envOverride?: Partial<AuthRuntimeEnv>;
} = {}) => {
  const store = createStore(billing);
  const operationStore = createOperationStore();
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
      getSessionIdentity: vi.fn(async () => ({
        userId: 'user-1',
        email: 'owner@example.com',
        emailVerified: true,
        activeOrganizationId: 'organization-1',
      })),
      resolveOrganizationId: vi.fn(
        ({ requestedOrganizationId, activeOrganizationId }) =>
          requestedOrganizationId ?? activeOrganizationId,
      ),
      readOrganizationMembershipRole: vi.fn(async () => role),
      readOrganizationSubject: vi.fn(async () => ({
        id: 'organization-1',
        name: '予約テスト組織',
        slug: 'reserve-test',
      })),
      resolveE2eStripeTestClockId: vi.fn(() => null),
    } as unknown as BillingRouteContext,
    store,
    operationStore,
    provider,
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT' });
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get('authorization')).toBe(
      'Bearer billing-api-key',
    );
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get('idempotency-key')).toBe(
      'reserve-action-sync:organization-1:attempt-1',
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
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/checkout-sessions',
    );
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      actor: {
        type: 'user',
        id: 'user-1',
        email: 'owner@example.com',
      },
      planCode: 'premium',
      interval: 'month',
      returnUrlKey: 'default',
    });
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
    expect(ctx.createProvider).not.toHaveBeenCalled();
    expect(provider.createTrialSubscription).not.toHaveBeenCalled();
    expect(store.startPremiumTrial).not.toHaveBeenCalled();
    expect(operationStore.markSucceeded).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
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
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/payment-method-setup-sessions',
    );
  });

  it('Billing API portal ハンドオフ作成失敗時に portal 操作を失敗として記録する', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: 'https://billing.test/portal',
      handoffStatus: 503,
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
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/billing-portal-sessions',
    );
  });

  it('Billing API action flag が有効なら trial complete は Billing API 経由で実行する', async () => {
    const fetchMock = createBillingApiFetch({
      handoffUrl: '',
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
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1/trial/complete',
    );
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Headers).get('idempotency-key')).toBe(
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
