import type { AuthRuntimeEnv } from '../auth-runtime.js';

type StripeCheckoutSessionCreateInput = {
  env: AuthRuntimeEnv;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId?: string;
  metadata?: Record<string, string>;
};

type StripeSubscriptionCheckoutSessionCreateInput = {
  env: AuthRuntimeEnv;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
  clientReferenceId?: string;
  metadata?: Record<string, string>;
};

type StripeSetupCheckoutSessionCreateInput = {
  env: AuthRuntimeEnv;
  successUrl: string;
  cancelUrl: string;
  customerId: string;
  clientReferenceId?: string;
  metadata?: Record<string, string>;
};

type StripeBillingPortalSessionCreateInput = {
  env: AuthRuntimeEnv;
  customerId: string;
  returnUrl: string;
  subscriptionUpdate?: {
    subscriptionId: string;
    afterCompletionReturnUrl: string;
  };
};

export type StripeCheckoutSession = {
  id: string;
  url: string;
  paymentStatus?: string;
  status?: string;
};

export type StripeWebhookEvent = {
  id: string;
  type: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

export type StripeCustomerSummary = {
  id: string;
  defaultPaymentMethodId: string | null;
};

export type StripeBillingCheckoutMetadata = {
  billingPurpose: 'organization_plan';
  organizationId: string;
  planCode: 'premium';
  billingInterval: 'month' | 'year';
};

export type StripeSubscriptionSummary = {
  id: string;
  customerId: string | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  priceId: string | null;
};

export type StripeInvoiceDocumentSummary = {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
};

export type StripeChargeReceiptDocumentSummary = {
  id: string;
  customerId: string | null;
  receiptUrl: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const timingSafeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
};

const parseStripeSignatureHeader = (header: string) => {
  const timestampCandidates: string[] = [];
  const v1Signatures: string[] = [];

  for (const part of header.split(',')) {
    const [rawKey, rawValue] = part.split('=', 2);
    const key = rawKey?.trim();
    const value = rawValue?.trim();
    if (!key || !value) {
      continue;
    }
    if (key === 't') {
      timestampCandidates.push(value);
      continue;
    }
    if (key === 'v1') {
      v1Signatures.push(value);
    }
  }

  return {
    timestamp: timestampCandidates[0] ?? null,
    v1Signatures,
  };
};

const hmacSha256Hex = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return toHex(signature);
};

const toStripeErrorMessage = (payload: unknown): string => {
  if (!isRecord(payload)) {
    return 'Stripe API request failed.';
  }

  const error = payload.error;
  if (!isRecord(error)) {
    return 'Stripe API request failed.';
  }

  if (typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }

  return 'Stripe API request failed.';
};

const requireStripeSecretKey = (env: AuthRuntimeEnv): string => {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }
  return secretKey;
};

const postStripeForm = async ({
  env,
  path,
  params,
}: {
  env: AuthRuntimeEnv;
  path: string;
  params: URLSearchParams;
}) => {
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, '')}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${requireStripeSecretKey(env)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(toStripeErrorMessage(payload));
  }

  return payload;
};

const getStripeJson = async ({
  env,
  path,
  query,
}: {
  env: AuthRuntimeEnv;
  path: string;
  query?: URLSearchParams;
}) => {
  const normalizedPath = path.replace(/^\/+/, '');
  const url = new URL(`https://api.stripe.com/v1/${normalizedPath}`);
  if (query) {
    url.search = query.toString();
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${requireStripeSecretKey(env)}`,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(toStripeErrorMessage(payload));
  }

  return payload;
};

export const createCustomer = async ({
  env,
  name,
  metadata,
}: {
  env: AuthRuntimeEnv;
  name?: string;
  metadata?: Record<string, string>;
}): Promise<{ id: string }> => {
  const params = new URLSearchParams();

  if (name) {
    params.set('name', name);
  }

  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      params.set(`metadata[${key}]`, value);
    }
  }

  const payload = await postStripeForm({
    env,
    path: 'customers',
    params,
  });

  if (!isRecord(payload) || typeof payload.id !== 'string') {
    throw new Error('Invalid Stripe customer response.');
  }

  return {
    id: payload.id,
  };
};

export const createCheckoutSession = async ({
  env,
  priceId,
  successUrl,
  cancelUrl,
  clientReferenceId,
  metadata,
}: StripeCheckoutSessionCreateInput): Promise<StripeCheckoutSession> => {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');

  if (clientReferenceId) {
    params.set('client_reference_id', clientReferenceId);
  }

  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      params.set(`metadata[${key}]`, value);
    }
  }

  const payload = await postStripeForm({
    env,
    path: 'checkout/sessions',
    params,
  });

  if (!isRecord(payload) || typeof payload.id !== 'string' || typeof payload.url !== 'string') {
    throw new Error('Invalid Stripe checkout session response.');
  }

  return {
    id: payload.id,
    url: payload.url,
    paymentStatus: typeof payload.payment_status === 'string' ? payload.payment_status : undefined,
    status: typeof payload.status === 'string' ? payload.status : undefined,
  };
};

export const createSubscriptionCheckoutSession = async ({
  env,
  priceId,
  successUrl,
  cancelUrl,
  customerId,
  clientReferenceId,
  metadata,
}: StripeSubscriptionCheckoutSessionCreateInput): Promise<StripeCheckoutSession> => {
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');

  if (customerId) {
    params.set('customer', customerId);
  }

  if (clientReferenceId) {
    params.set('client_reference_id', clientReferenceId);
  }

  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      params.set(`metadata[${key}]`, value);
    }
  }

  const payload = await postStripeForm({
    env,
    path: 'checkout/sessions',
    params,
  });

  if (!isRecord(payload) || typeof payload.id !== 'string' || typeof payload.url !== 'string') {
    throw new Error('Invalid Stripe subscription checkout session response.');
  }

  return {
    id: payload.id,
    url: payload.url,
    paymentStatus: typeof payload.payment_status === 'string' ? payload.payment_status : undefined,
    status: typeof payload.status === 'string' ? payload.status : undefined,
  };
};

export const createSetupCheckoutSession = async ({
  env,
  successUrl,
  cancelUrl,
  customerId,
  clientReferenceId,
  metadata,
}: StripeSetupCheckoutSessionCreateInput): Promise<StripeCheckoutSession> => {
  const params = new URLSearchParams();
  params.set('mode', 'setup');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('customer', customerId);

  if (clientReferenceId) {
    params.set('client_reference_id', clientReferenceId);
  }

  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      params.set(`metadata[${key}]`, value);
    }
  }

  const payload = await postStripeForm({
    env,
    path: 'checkout/sessions',
    params,
  });

  if (!isRecord(payload) || typeof payload.id !== 'string' || typeof payload.url !== 'string') {
    throw new Error('Invalid Stripe setup checkout session response.');
  }

  return {
    id: payload.id,
    url: payload.url,
    paymentStatus: typeof payload.payment_status === 'string' ? payload.payment_status : undefined,
    status: typeof payload.status === 'string' ? payload.status : undefined,
  };
};

export const createBillingPortalSession = async ({
  env,
  customerId,
  returnUrl,
  subscriptionUpdate,
}: StripeBillingPortalSessionCreateInput): Promise<{ url: string }> => {
  const params = new URLSearchParams();
  params.set('customer', customerId);
  params.set('return_url', returnUrl);
  if (subscriptionUpdate) {
    params.set('flow_data[type]', 'subscription_update');
    params.set('flow_data[subscription_update][subscription]', subscriptionUpdate.subscriptionId);
    params.set('flow_data[after_completion][type]', 'redirect');
    params.set(
      'flow_data[after_completion][redirect][return_url]',
      subscriptionUpdate.afterCompletionReturnUrl,
    );
  }

  const payload = await postStripeForm({
    env,
    path: 'billing_portal/sessions',
    params,
  });

  if (!isRecord(payload) || typeof payload.url !== 'string') {
    throw new Error('Invalid Stripe billing portal session response.');
  }

  return {
    url: payload.url,
  };
};

export const readStripeCustomerSummary = async ({
  env,
  customerId,
}: {
  env: AuthRuntimeEnv;
  customerId: string;
}): Promise<StripeCustomerSummary> => {
  const query = new URLSearchParams();
  query.append('expand[]', 'invoice_settings.default_payment_method');

  const payload = await getStripeJson({
    env,
    path: `customers/${encodeURIComponent(customerId)}`,
    query,
  });

  if (!isRecord(payload) || typeof payload.id !== 'string') {
    throw new Error('Invalid Stripe customer response.');
  }

  const invoiceSettings = isRecord(payload.invoice_settings) ? payload.invoice_settings : null;
  const defaultPaymentMethod = invoiceSettings?.default_payment_method;
  const defaultPaymentMethodId =
    typeof defaultPaymentMethod === 'string'
      ? defaultPaymentMethod
      : isRecord(defaultPaymentMethod) && typeof defaultPaymentMethod.id === 'string'
        ? defaultPaymentMethod.id
        : null;

  return {
    id: payload.id,
    defaultPaymentMethodId,
  };
};

export const readStripeSubscriptionSummaryById = async ({
  env,
  subscriptionId,
}: {
  env: AuthRuntimeEnv;
  subscriptionId: string;
}): Promise<StripeSubscriptionSummary> => {
  const query = new URLSearchParams();
  query.append('expand[]', 'items.data.price');

  const payload = await getStripeJson({
    env,
    path: `subscriptions/${encodeURIComponent(subscriptionId)}`,
    query,
  });
  const summary = readStripeSubscriptionSummary(payload);
  if (!summary) {
    throw new Error('Invalid Stripe subscription response.');
  }

  return summary;
};

export const verifyStripeWebhookSignature = async ({
  rawBody,
  signatureHeader,
  webhookSecret,
  toleranceSeconds = 300,
}: {
  rawBody: string;
  signatureHeader: string | null;
  webhookSecret?: string;
  toleranceSeconds?: number;
}): Promise<boolean> => {
  const secret = webhookSecret?.trim();
  if (!secret || !signatureHeader) {
    return false;
  }

  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed.timestamp || parsed.v1Signatures.length === 0) {
    return false;
  }

  const timestampSeconds = Number(parsed.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) {
    return false;
  }

  const signedPayload = `${parsed.timestamp}.${rawBody}`;
  const expected = await hmacSha256Hex(secret, signedPayload);

  return parsed.v1Signatures.some((candidate) => timingSafeEqual(candidate, expected));
};

export const parseStripeWebhookEvent = (rawBody: string): StripeWebhookEvent | null => {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!isRecord(parsed) || typeof parsed.id !== 'string' || typeof parsed.type !== 'string') {
      return null;
    }

    const data = isRecord(parsed.data)
      ? {
          object: isRecord(parsed.data.object)
            ? (parsed.data.object as Record<string, unknown>)
            : undefined,
        }
      : undefined;

    return {
      id: parsed.id,
      type: parsed.type,
      data,
    };
  } catch {
    return null;
  }
};

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const readStripeObjectId = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return readString(value);
  }
  if (!isRecord(value)) {
    return null;
  }
  return readString(value.id);
};

const readBoolean = (value: unknown): boolean => value === true;

const readUnixSecondsDate = (value: unknown): Date | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return new Date(value * 1000);
};

const resolveSubscriptionPeriodBounds = (
  items: unknown[],
): {
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
} => {
  const starts = items
    .map((item) => (isRecord(item) ? readUnixSecondsDate(item.current_period_start) : null))
    .filter((value): value is Date => value instanceof Date);
  const ends = items
    .map((item) => (isRecord(item) ? readUnixSecondsDate(item.current_period_end) : null))
    .filter((value): value is Date => value instanceof Date);

  return {
    // Match Stripe's former subscription-level semantics for mixed intervals.
    currentPeriodStart:
      starts.length > 0 ? new Date(Math.max(...starts.map((value) => value.getTime()))) : null,
    currentPeriodEnd:
      ends.length > 0 ? new Date(Math.min(...ends.map((value) => value.getTime()))) : null,
  };
};

export const readStripeBillingCheckoutMetadata = (
  value: unknown,
): StripeBillingCheckoutMetadata | null => {
  if (!isRecord(value)) {
    return null;
  }

  const billingPurpose = readString(value.billingPurpose);
  const organizationId = readString(value.organizationId);
  const planCode = readString(value.planCode);
  const billingInterval = readString(value.billingInterval);
  if (
    billingPurpose !== 'organization_plan' ||
    !organizationId ||
    planCode !== 'premium' ||
    (billingInterval !== 'month' && billingInterval !== 'year')
  ) {
    return null;
  }

  return {
    billingPurpose,
    organizationId,
    planCode,
    billingInterval,
  };
};

export const readStripeInvoiceDocumentSummary = (
  value: unknown,
): StripeInvoiceDocumentSummary | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  if (!id) {
    return null;
  }

  return {
    id,
    customerId: readStripeObjectId(value.customer),
    subscriptionId: readStripeObjectId(value.subscription),
    hostedInvoiceUrl: readString(value.hosted_invoice_url),
    invoicePdfUrl: readString(value.invoice_pdf),
  };
};

export const readStripeChargeReceiptDocumentSummary = (
  value: unknown,
): StripeChargeReceiptDocumentSummary | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  if (!id) {
    return null;
  }

  return {
    id,
    customerId: readStripeObjectId(value.customer),
    receiptUrl: readString(value.receipt_url),
  };
};

export const readStripeSubscriptionInvoiceDocumentSummaries = async ({
  env,
  customerId,
  subscriptionId,
  limit = 10,
}: {
  env: AuthRuntimeEnv;
  customerId: string;
  subscriptionId?: string | null;
  limit?: number;
}): Promise<StripeInvoiceDocumentSummary[]> => {
  const query = new URLSearchParams();
  query.set('customer', customerId);
  if (subscriptionId) {
    query.set('subscription', subscriptionId);
  }
  query.set('limit', String(Math.max(1, Math.min(Math.trunc(limit), 100))));
  query.append('expand[]', 'data.payment_intent.latest_charge');

  const payload = await getStripeJson({
    env,
    path: 'invoices',
    query,
  });
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];

  return data
    .map(readStripeInvoiceDocumentSummary)
    .filter((summary): summary is StripeInvoiceDocumentSummary => summary !== null);
};

export const readStripeCheckoutSessionSummary = (
  value: unknown,
): {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  metadata: Record<string, unknown>;
} | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  if (!id) {
    return null;
  }

  return {
    id,
    customerId: readString(value.customer),
    subscriptionId: readString(value.subscription),
    metadata: isRecord(value.metadata) ? value.metadata : {},
  };
};

export const readStripeSubscriptionSummary = (value: unknown): StripeSubscriptionSummary | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  if (!id) {
    return null;
  }

  const items = isRecord(value.items) && Array.isArray(value.items.data) ? value.items.data : [];
  const firstItem = items[0];
  const price =
    isRecord(firstItem) && isRecord(firstItem.price) ? firstItem.price : isRecord(value.plan) ? value.plan : null;
  const itemPeriodBounds = resolveSubscriptionPeriodBounds(items);

  return {
    id,
    customerId: readString(value.customer),
    status: readString(value.status),
    cancelAtPeriodEnd: readBoolean(value.cancel_at_period_end),
    currentPeriodStart: readUnixSecondsDate(value.current_period_start) ?? itemPeriodBounds.currentPeriodStart,
    currentPeriodEnd: readUnixSecondsDate(value.current_period_end) ?? itemPeriodBounds.currentPeriodEnd,
    priceId: price ? readString(price.id) : null,
  };
};
