export type BillingApiAppId = string;
export type BillingApiSubjectType = string;
export type BillingApiSubjectId = string;
export type BillingApiProvider = 'stripe';
export type BillingApiInterval = 'month' | 'year';
export type BillingApiPriceResolution = 'not_applicable' | 'known' | 'unknown';
export type BillingApiCredentialScope =
  | 'subject:write'
  | 'billing:read'
  | 'billing:write'
  | 'billing:test_clock';

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
  revision: number;
  status: BillingApiSubjectStatus;
  displayName: string;
  billingEmail: string | null;
  billingName: string | null;
  billingContacts: BillingApiBillingContact[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BillingSubjectChangedReason =
  | 'stripe.checkout.session.completed'
  | 'stripe.customer.subscription.created'
  | 'stripe.customer.subscription.updated'
  | 'stripe.customer.subscription.deleted'
  | 'stripe.subscription_schedule.created'
  | 'stripe.subscription_schedule.updated'
  | 'stripe.subscription_schedule.released'
  | 'stripe.subscription_schedule.completed'
  | 'stripe.invoice.finalized'
  | 'stripe.invoice.paid'
  | 'stripe.invoice.payment_succeeded'
  | 'stripe.invoice.payment_failed'
  | 'stripe.invoice.payment_action_required'
  | 'command.trial.started'
  | 'command.trial.completed'
  | 'command.addon.updated';

export type BillingSubjectChangedEvent = {
  schemaVersion: 1;
  eventId: string;
  eventType: 'billing.subject.changed.v1';
  appId: BillingApiAppId;
  subject: {
    type: BillingApiSubjectType;
    id: BillingApiSubjectId;
    revision: number;
  };
  reason: BillingSubjectChangedReason;
  affectedResources: Array<'account' | 'subscription' | 'entitlements' | 'invoice' | 'addons'>;
  occurredAt: string;
  provider: {
    name: 'stripe';
    eventId: string | null;
    customerId: string | null;
    subscriptionId: string | null;
  };
  invoiceEvent: {
    id: string;
    type: BillingApiInvoiceEventType;
    providerInvoiceId: string | null;
    providerPaymentIntentId: string | null;
    providerStatus: string | null;
    occurredAt: string | null;
  } | null;
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
  providerPriceId: string | null;
  priceResolution: BillingApiPriceResolution;
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
  priceResolution: BillingApiPriceResolution;
  features: Record<string, unknown>;
  entitlements: BillingApiEntitlement[];
  syncedAt: string;
  evaluatedAt: string;
  timeSource: 'server' | 'stripe_test_clock';
  maxStaleSeconds: number;
};

export type BillingApiInvoiceEventType =
  | 'invoice_available'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'payment_action_required';

export type BillingApiInvoiceEventOwnerFacingStatus =
  | 'available'
  | 'succeeded'
  | 'failed'
  | 'action_required';

export type BillingApiInvoiceEvent = {
  id: string;
  provider: BillingApiProvider;
  providerEventId: string | null;
  eventType: BillingApiInvoiceEventType;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  providerInvoiceId: string | null;
  providerPaymentIntentId: string | null;
  providerStatus: string | null;
  ownerFacingStatus: BillingApiInvoiceEventOwnerFacingStatus;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  occurredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BillingApiInvoiceEventsResponse = {
  appId: BillingApiAppId;
  subjectType: BillingApiSubjectType;
  subjectId: BillingApiSubjectId;
  events: BillingApiInvoiceEvent[];
  limit: number;
  hasMore: boolean;
  syncedAt: string;
};

export type BillingApiSummaryResponse = {
  subject: BillingApiSubject;
  account: BillingApiAccount;
  subscription: BillingApiSubscription;
  entitlements: BillingApiEntitlementsResponse;
  provider: {
    stripeConfigured: boolean;
    stripeWebhookConfigured: boolean;
  };
};

/** 現在の契約に紐づくアドオン数量と、期間末に反映される予定数量です。 */
export type BillingApiAddonItem = {
  addonCode: string;
  quantity: number;
  status: 'active' | 'inactive';
  pendingQuantity: number | null;
  pendingEffectiveAt: string | null;
};

/** subject 単位のアドオン明細です。Stripe の内部 ID は公開しません。 */
export type BillingApiAddonItemsResponse = {
  appId: BillingApiAppId;
  subjectType: BillingApiSubjectType;
  subjectId: BillingApiSubjectId;
  items: BillingApiAddonItem[];
  syncedAt: string;
};

export type BillingApiHandoffRequest = {
  actor: BillingApiActor;
  planCode?: string;
  interval?: BillingApiInterval;
  returnUrlKey?: string;
  returnUrlOverride?: string;
};

/** 変更対象だけを指定するアドオン数量の部分更新です。`0` は期間末削除を表します。 */
export type BillingApiAddonItemsUpdateRequest = {
  actor: BillingApiActor;
  items: Array<{
    addonCode: string;
    quantity: number;
  }>;
};

export type BillingApiAddonItemsUpdateResponse = {
  summary: BillingApiSummaryResponse;
  addonItems: BillingApiAddonItemsResponse;
};

export type BillingApiHandoffResponse = {
  status: 'processing' | 'succeeded' | 'failed' | 'conflict';
  message: string;
  url: string | null;
  operationAttemptId: string | null;
  reused: boolean;
};

export type BillingApiTestClockScenarioType =
  | 'trial_expired_without_payment_method'
  | 'monthly_renewal_success'
  | 'payment_failed';

export type BillingApiTestClockScenarioStatus =
  | 'ready'
  | 'advancing'
  | 'failed'
  | 'deleted'
  | 'unknown';

export type BillingApiTestClockScenario = {
  scenarioId: string;
  appId: BillingApiAppId;
  scenarioType: BillingApiTestClockScenarioType;
  status: BillingApiTestClockScenarioStatus;
  provider: BillingApiProvider;
  providerTestClockId: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  frozenTime: string;
  targetFrozenTime: string | null;
  lastAdvancedAt: string | null;
  sourceSubject: {
    subjectType: BillingApiSubjectType;
    subjectId: BillingApiSubjectId;
  };
  testSubject: {
    subjectType: BillingApiSubjectType;
    subjectId: BillingApiSubjectId;
  };
  summary: BillingApiSummaryResponse;
  createdAt: string;
  updatedAt: string;
};

export type BillingApiCreateTestClockScenarioRequest = {
  scenarioType: BillingApiTestClockScenarioType;
  frozenTime?: string | null;
  planCode?: string;
  interval?: BillingApiInterval;
  trialDays?: number;
  actor?: BillingApiActor;
};

export type BillingApiAdvanceTestClockScenarioRequest = {
  frozenTime?: string | null;
  advanceBy?: {
    amount: number;
    unit: 'day' | 'month';
  } | null;
};

export type BillingApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden_app'
  | 'forbidden_scope'
  | 'subject_not_found'
  | 'idempotency_key_required'
  | 'idempotency_conflict'
  | 'provider_not_configured'
  | 'test_clock_disabled'
  | 'not_implemented'
  | 'internal_error';

export type BillingApiErrorResponse = {
  error: {
    code: BillingApiErrorCode;
    message: string;
    requestId?: string;
  };
};
