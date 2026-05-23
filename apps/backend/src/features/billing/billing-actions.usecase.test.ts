import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const createContext = ({
  billing = freeBilling,
  role = 'owner',
  provider = createProvider(),
}: {
  billing?: typeof freeBilling;
  role?: 'owner' | 'admin' | 'member' | null;
  provider?: BillingProvider;
} = {}) => {
  const store = createStore(billing);
  const operationStore = createOperationStore();

  return {
    ctx: {
      auth: null,
      database: null,
      env,
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
      resolveE2eStripeTestClockId: vi.fn(() => null),
    } as unknown as BillingRouteContext,
    store,
    operationStore,
    provider,
  };
};

describe('billing action usecases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks checkout operation succeeded when Stripe checkout handoff is created', async () => {
    const { ctx, operationStore } = createContext();

    const result = await createSubscriptionCheckoutHandoff({
      ctx,
      body: { organizationId: 'organization-1', billingInterval: 'month' },
      headers: new Headers(),
    });

    expect(result.status).toBe(200);
    expect(operationStore.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'attempt-1',
        handoffUrl: 'https://stripe.test/checkout',
        stripeCustomerId: 'cus_free',
        stripeCheckoutSessionId: 'cs_checkout',
      }),
    );
    expect(operationStore.markFailed).not.toHaveBeenCalled();
  });

  it('marks checkout operation failed when Stripe checkout handoff creation fails', async () => {
    const provider = createProvider({
      createSubscriptionCheckoutSession: vi.fn(async () => {
        throw new Error('checkout failed');
      }),
    });
    const { ctx, operationStore } = createContext({ provider });

    const result = await createSubscriptionCheckoutHandoff({
      ctx,
      body: { organizationId: 'organization-1', billingInterval: 'month' },
      headers: new Headers(),
    });

    expect(result.status).toBe(500);
    expect(operationStore.markFailed).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      failureReason: 'checkout failed',
    });
    expect(operationStore.markSucceeded).not.toHaveBeenCalled();
  });

  it('marks trial operation failed when trial state update fails', async () => {
    const { ctx, store, operationStore } = createContext();
    vi.mocked(store.startPremiumTrial).mockRejectedValue(new Error('trial update failed'));

    const result = await startTrialSubscription({
      ctx,
      body: { organizationId: 'organization-1' },
      headers: new Headers(),
    });

    expect(result.status).toBe(500);
    expect(operationStore.markFailed).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      failureReason: 'trial update failed',
    });
  });

  it('marks setup operation failed when setup handoff creation fails', async () => {
    const provider = createProvider({
      createSetupCheckoutSession: vi.fn(async () => {
        throw new Error('setup failed');
      }),
    });
    const { ctx, operationStore } = createContext({ billing: trialBilling, provider });

    const result = await createSetupCheckoutHandoff({
      ctx,
      body: { organizationId: 'organization-1' },
      headers: new Headers(),
    });

    expect(result.status).toBe(500);
    expect(operationStore.markFailed).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      failureReason: 'setup failed',
    });
  });

  it('marks portal operation failed when portal handoff creation fails', async () => {
    const provider = createProvider({
      createBillingPortalSession: vi.fn(async () => {
        throw new Error('portal failed');
      }),
    });
    const { ctx, operationStore } = createContext({ billing: paidBilling, provider });

    const result = await createSubscriptionUpdatePortalHandoff({
      ctx,
      body: { organizationId: 'organization-1' },
      headers: new Headers(),
    });

    expect(result.status).toBe(500);
    expect(operationStore.markFailed).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      failureReason: 'portal failed',
    });
  });

  it('returns 403 before operation claim for non-owner billing actions', async () => {
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
