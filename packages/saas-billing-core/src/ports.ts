import type { BillingInterval, BillingPortalFlow } from './types.js';

export type ProviderCustomer = {
  id: string;
};

export type ProviderSubscription = {
  id: string;
  customerId: string | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  priceId: string | null;
};

export type ProviderCheckoutSession = {
  id: string;
  url: string;
  paymentStatus?: string;
  status?: string;
};

export type ProviderPortalSession = {
  id: string | null;
  url: string;
};

export type ProviderCustomerSummary = {
  id: string;
  defaultPaymentMethodId: string | null;
};

export interface BillingProvider {
  createCustomer(input: {
    email?: string | null;
    name?: string | null;
    metadata?: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderCustomer>;

  createTrialSubscription(input: {
    customerId: string;
    priceId: string;
    trialDays: number;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderSubscription>;

  createSubscriptionCheckoutSession(input: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderCheckoutSession>;

  createSetupCheckoutSession(input: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderCheckoutSession>;

  createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
    flow: BillingPortalFlow;
    idempotencyKey: string;
  }): Promise<ProviderPortalSession>;

  retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription | null>;

  retrieveCustomerSummary(customerId: string): Promise<ProviderCustomerSummary | null>;
}

export type BillingPlanPrice = {
  planCode: string;
  interval: BillingInterval;
  providerPriceId: string;
};
