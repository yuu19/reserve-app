import type {
  BillingEntitlementSource,
  BillingInterval,
  BillingPaymentIssueStartedAtSource,
  BillingPaymentIssueState,
  BillingPortalFlow,
  BillingProviderCode,
  BillingSubjectType,
  BillingSubscriptionStatus,
} from './types.js';

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

export type BillingAccount = {
  id: string;
  subjectType: BillingSubjectType;
  subjectId: string;
  provider: BillingProviderCode;
  providerCustomerId: string | null;
  billingEmail: string | null;
  billingName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BillingSubscription = {
  id: string;
  billingAccountId: string;
  provider: BillingProviderCode;
  providerSubscriptionId: string | null;
  providerScheduleId: string | null;
  planCode: string;
  priceCode: string | null;
  interval: BillingInterval | null;
  status: BillingSubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  cancelAt: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type BillingEntitlement = {
  id: string;
  billingAccountId: string;
  key: string;
  active: boolean;
  source: BillingEntitlementSource;
  reason: string;
  validFrom: Date | null;
  validUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BillingPaymentIssue = {
  id: string;
  billingAccountId: string;
  billingSubscriptionId: string | null;
  state: BillingPaymentIssueState;
  issueStartedAt: Date | null;
  issueStartedAtSource: BillingPaymentIssueStartedAtSource;
  pastDueGraceEndsAt: Date | null;
  latestProviderEventId: string | null;
  latestInvoiceId: string | null;
  latestPaymentIntentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BillingSubscriptionUpsert = {
  billingAccountId: string;
  provider: BillingProviderCode;
  providerSubscriptionId?: string | null;
  providerScheduleId?: string | null;
  planCode: string;
  priceCode?: string | null;
  interval?: BillingInterval | null;
  status: BillingSubscriptionStatus;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  trialStart?: Date | null;
  trialEnd?: Date | null;
  cancelAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
};

export type BillingEntitlementInput = {
  key: string;
  active: boolean;
  source: BillingEntitlementSource;
  reason: string;
  validFrom?: Date | null;
  validUntil?: Date | null;
};

export type BillingPaymentIssueUpsert = {
  billingAccountId: string;
  billingSubscriptionId?: string | null;
  state: BillingPaymentIssueState;
  issueStartedAt?: Date | null;
  issueStartedAtSource: BillingPaymentIssueStartedAtSource;
  pastDueGraceEndsAt?: Date | null;
  latestProviderEventId?: string | null;
  latestInvoiceId?: string | null;
  latestPaymentIntentId?: string | null;
};

export type BillingPaymentIssueEventInput = {
  billingAccountId: string;
  billingSubscriptionId?: string | null;
  eventType: string;
  provider: BillingProviderCode;
  providerEventId?: string | null;
  providerInvoiceId?: string | null;
  providerPaymentIntentId?: string | null;
  occurredAt?: Date | null;
};

export interface BillingStore {
  findAccountBySubject(input: {
    subjectType: BillingSubjectType;
    subjectId: string;
  }): Promise<BillingAccount | null>;

  ensureAccount(input: {
    subjectType: BillingSubjectType;
    subjectId: string;
    provider: BillingProviderCode;
    billingEmail?: string | null;
    billingName?: string | null;
  }): Promise<BillingAccount>;

  updateProviderCustomerId(input: {
    billingAccountId: string;
    providerCustomerId: string;
  }): Promise<void>;

  findAccountByProviderCustomer(input: {
    provider: BillingProviderCode;
    providerCustomerId: string;
  }): Promise<BillingAccount | null>;

  findCurrentSubscription(input: { billingAccountId: string }): Promise<BillingSubscription | null>;

  findSubscriptionByProviderSubscription(input: {
    provider: BillingProviderCode;
    providerSubscriptionId: string;
  }): Promise<BillingSubscription | null>;

  upsertSubscription(input: BillingSubscriptionUpsert): Promise<BillingSubscription>;

  readEntitlements(input: { billingAccountId: string }): Promise<BillingEntitlement[]>;

  replaceEntitlements(input: {
    billingAccountId: string;
    entitlements: BillingEntitlementInput[];
  }): Promise<void>;

  readPaymentIssue(input: { billingAccountId: string }): Promise<BillingPaymentIssue | null>;

  upsertPaymentIssue(input: BillingPaymentIssueUpsert): Promise<void>;

  appendPaymentIssueEvent(input: BillingPaymentIssueEventInput): Promise<void>;
}
