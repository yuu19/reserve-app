export type BillingApiAppId = string;
export type BillingApiSubjectType = string;
export type BillingApiSubjectId = string;
export type BillingApiProvider = 'stripe';
export type BillingApiInterval = 'month' | 'year';

export type BillingApiSubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';

export type BillingApiSubjectStatus = 'active' | 'archived';
export type BillingApiEntitlementSource = 'free' | 'trial' | 'paid' | 'manual' | 'admin_override';
export type BillingApiEntitlementValueType = 'boolean' | 'number' | 'string' | 'json' | 'none';

export type BillingApiActor = {
  type: 'user' | 'system';
  id: string | null;
  email?: string | null;
};

export type BillingApiBillingContact = {
  userId?: string | null;
  email: string;
  name?: string | null;
  role?: string | null;
};

export type BillingApiSubjectSyncRequest = {
  displayName: string;
  billingEmail?: string | null;
  billingName?: string | null;
  billingContacts?: BillingApiBillingContact[];
  metadata?: Record<string, unknown>;
};

export type BillingApiSubject = {
  appId: BillingApiAppId;
  subjectType: BillingApiSubjectType;
  subjectId: BillingApiSubjectId;
  status: BillingApiSubjectStatus;
  displayName: string;
  billingEmail: string | null;
  billingName: string | null;
  billingContacts: BillingApiBillingContact[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BillingApiAccount = {
  id: string;
  provider: BillingApiProvider;
  providerCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BillingApiSubscription = {
  id: string;
  provider: BillingApiProvider;
  providerSubscriptionId: string | null;
  planCode: string;
  priceCode: string | null;
  interval: BillingApiInterval | null;
  status: BillingApiSubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
} | null;

export type BillingApiEntitlement = {
  key: string;
  active: boolean;
  valueType: BillingApiEntitlementValueType;
  value: unknown;
  source: BillingApiEntitlementSource;
  reason: string;
  validFrom: string | null;
  validUntil: string | null;
  generatedAt: string;
};

export type BillingApiEntitlementsResponse = {
  appId: BillingApiAppId;
  subjectType: BillingApiSubjectType;
  subjectId: BillingApiSubjectId;
  planCode: string;
  status: BillingApiSubscriptionStatus;
  entitlements: BillingApiEntitlement[];
  syncedAt: string;
  maxStaleSeconds: number;
};

export type BillingApiSummaryResponse = {
  subject: BillingApiSubject;
  account: BillingApiAccount;
  subscription: BillingApiSubscription;
  entitlements: BillingApiEntitlementsResponse;
};

export type BillingApiHandoffRequest = {
  actor: BillingApiActor;
  planCode?: string;
  interval?: BillingApiInterval;
  returnUrlKey?: string;
  returnUrlOverride?: string;
};

export type BillingApiHandoffResponse = {
  status: 'processing' | 'succeeded' | 'failed' | 'conflict';
  message: string;
  url: string | null;
  operationAttemptId: string | null;
  reused: boolean;
};

export type BillingApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden_app'
  | 'subject_not_found'
  | 'idempotency_key_required'
  | 'idempotency_conflict'
  | 'provider_not_configured'
  | 'not_implemented'
  | 'internal_error';

export type BillingApiErrorResponse = {
  error: {
    code: BillingApiErrorCode;
    message: string;
    requestId?: string;
  };
};
