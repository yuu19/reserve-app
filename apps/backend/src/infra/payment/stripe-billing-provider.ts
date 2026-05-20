import type {
  BillingPortalFlow,
  BillingProvider,
  ProviderCheckoutSession,
  ProviderCustomer,
  ProviderCustomerSummary,
  ProviderPortalSession,
  ProviderSubscription,
} from '@repo/saas-billing-core';
import type { AuthRuntimeEnv } from '../../auth-runtime.js';
import {
  createBillingPortalSession,
  createCustomer,
  createSetupCheckoutSession,
  createSubscriptionCheckoutSession,
  createTrialSubscription,
  readStripeCustomerSummary,
  readStripeSubscriptionSummaryById,
} from './stripe.js';

export type StripeBillingProviderOptions = {
  env: AuthRuntimeEnv;
  testClockId?: string | null;
};

const toSubscription = (subscription: ProviderSubscription): ProviderSubscription => subscription;

const toPortalSessionInput = ({
  flow,
  returnUrl,
}: {
  flow: BillingPortalFlow;
  returnUrl: string;
}) => {
  if (flow.type === 'subscription_update') {
    const afterCompletionReturnUrl = new URL(returnUrl);
    afterCompletionReturnUrl.searchParams.set('subscription', 'success');
    return {
      subscriptionUpdate: {
        subscriptionId: flow.subscriptionId,
        afterCompletionReturnUrl: afterCompletionReturnUrl.toString(),
      },
    };
  }

  return {};
};

export const createStripeBillingProvider = ({
  env,
  testClockId = null,
}: StripeBillingProviderOptions): BillingProvider => ({
  async createCustomer({ name, metadata, idempotencyKey }): Promise<ProviderCustomer> {
    return createCustomer({
      env,
      name: name ?? undefined,
      testClockId,
      metadata,
      idempotencyKey,
    });
  },

  async createTrialSubscription({
    customerId,
    priceId,
    trialDays,
    metadata,
    idempotencyKey,
  }): Promise<ProviderSubscription> {
    return toSubscription(
      await createTrialSubscription({
        env,
        customerId,
        priceId,
        trialPeriodDays: trialDays,
        metadata,
        idempotencyKey,
      }),
    );
  },

  async createSubscriptionCheckoutSession({
    customerId,
    priceId,
    successUrl,
    cancelUrl,
    metadata,
    idempotencyKey,
  }): Promise<ProviderCheckoutSession> {
    return createSubscriptionCheckoutSession({
      env,
      customerId,
      priceId,
      successUrl,
      cancelUrl,
      clientReferenceId: metadata.organizationId,
      metadata,
      idempotencyKey,
    });
  },

  async createSetupCheckoutSession({
    customerId,
    successUrl,
    cancelUrl,
    metadata,
    idempotencyKey,
  }): Promise<ProviderCheckoutSession> {
    return createSetupCheckoutSession({
      env,
      customerId,
      successUrl,
      cancelUrl,
      clientReferenceId: metadata.organizationId,
      metadata,
      idempotencyKey,
    });
  },

  async createBillingPortalSession({
    customerId,
    returnUrl,
    flow,
    idempotencyKey,
  }): Promise<ProviderPortalSession> {
    return createBillingPortalSession({
      env,
      customerId,
      returnUrl,
      idempotencyKey,
      ...toPortalSessionInput({ flow, returnUrl }),
    });
  },

  async retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription | null> {
    return readStripeSubscriptionSummaryById({ env, subscriptionId });
  },

  async retrieveCustomerSummary(customerId: string): Promise<ProviderCustomerSummary | null> {
    return readStripeCustomerSummary({ env, customerId });
  },
});
