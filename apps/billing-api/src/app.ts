import type {
  BillingApiAccount,
  BillingApiActor,
  BillingApiBillingContact,
  BillingApiEntitlement,
  BillingApiEntitlementsResponse,
  BillingApiErrorCode,
  BillingApiErrorResponse,
  BillingApiHandoffRequest,
  BillingApiHandoffResponse,
  BillingApiPriceResolution,
  BillingApiSubject,
  BillingApiSubjectSyncRequest,
  BillingApiSummaryResponse,
  BillingApiSubscription,
  BillingApiSubscriptionStatus,
} from '@repo/billing-types';
import { and, desc, eq, gt, isNull, lt, max } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { createBillingApiDatabase, type BillingApiDatabase } from './db/database.js';
import * as dbSchema from './db/schema.js';

type BillingApiBindings = {
  DB: D1Database;
  BILLING_ENTITLEMENT_MAX_STALE_SECONDS?: string;
  BILLING_API_IDEMPOTENCY_TTL_SECONDS?: string;
  BILLING_HANDOFF_REUSE_SECONDS?: string;
  BILLING_DEFAULT_RETURN_URL_KEY?: string;
  BILLING_RETURN_URL_OVERRIDE_ALLOWED?: string;
  BILLING_DEFAULT_CURRENCY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_API_VERSION?: string;
  STRIPE_WEBHOOK_SECRET?: string;
};

type BillingApiVariables = {
  appId: string;
  db: BillingApiDatabase;
};

type BillingApiContext = Context<{
  Bindings: BillingApiBindings;
  Variables: BillingApiVariables;
}>;

type JsonResult<TBody> = {
  status: number;
  body: TBody;
};

const textEncoder = new TextEncoder();

const createId = () => crypto.randomUUID();

const now = () => new Date();

const DEFAULT_HANDOFF_REUSE_SECONDS = 30 * 60;
const DEFAULT_OPERATION_PENDING_STALE_MS = 2 * 60 * 1000;
const DEFAULT_RETURN_URL_KEY = 'default';
const DEFAULT_STRIPE_API_VERSION = '2026-04-22.dahlia';

const toIso = (value: Date | null | undefined): string | null =>
  value instanceof Date ? value.toISOString() : null;

const toDateFromUnixSeconds = (value: unknown): Date | null => {
  const seconds =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : null;
  if (seconds === null || !Number.isFinite(seconds)) {
    return null;
  }
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const hmacSha256Hex = async ({ secret, payload }: { secret: string; payload: string }) => {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const safeJsonParse = (value: string, fallback: unknown): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
};

const readObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const readBillingContacts = (value: string): BillingApiBillingContact[] => {
  const parsed = safeJsonParse(value, []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((entry): BillingApiBillingContact | null => {
      const record = readObject(entry);
      return typeof record.email === 'string' && record.email.length > 0
        ? {
            email: record.email,
            userId: typeof record.userId === 'string' ? record.userId : null,
            name: typeof record.name === 'string' ? record.name : null,
            role: typeof record.role === 'string' ? record.role : null,
          }
        : null;
    })
    .filter((entry): entry is BillingApiBillingContact => entry !== null);
};

const normalizeContacts = (value: unknown): BillingApiBillingContact[] =>
  Array.isArray(value)
    ? value
        .map((entry): BillingApiBillingContact | null => {
          const record = readObject(entry);
          const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
          return email
            ? {
                email,
                userId: typeof record.userId === 'string' ? record.userId : null,
                name: typeof record.name === 'string' ? record.name : null,
                role: typeof record.role === 'string' ? record.role : null,
              }
            : null;
        })
        .filter((entry): entry is BillingApiBillingContact => entry !== null)
    : [];

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const readStripeExpandableId = (value: unknown): string | null => {
  const direct = readString(value);
  if (direct) {
    return direct;
  }
  return readString(readObject(value).id);
};

const normalizePriceResolution = (value: string | null | undefined): BillingApiPriceResolution =>
  value === 'known' || value === 'unknown' ? value : 'not_applicable';

const toStripeErrorMessage = (payload: unknown): string => {
  const record = readObject(payload);
  const error = readObject(record.error);
  return typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : 'Stripe API request failed.';
};

const requireStripeSecretKey = (env: BillingApiBindings): string => {
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
  idempotencyKey,
}: {
  env: BillingApiBindings;
  path: string;
  params: URLSearchParams;
  idempotencyKey?: string;
}) => {
  const headers: Record<string, string> = {
    authorization: `Bearer ${requireStripeSecretKey(env)}`,
    'content-type': 'application/x-www-form-urlencoded',
    'stripe-version': env.STRIPE_API_VERSION?.trim() || DEFAULT_STRIPE_API_VERSION,
  };
  if (idempotencyKey?.trim()) {
    headers['idempotency-key'] = idempotencyKey.trim();
  }

  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, '')}`, {
    method: 'POST',
    headers,
    body: params.toString(),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(toStripeErrorMessage(payload));
  }
  return payload;
};

const getStripeJson = async ({ env, path }: { env: BillingApiBindings; path: string }) => {
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, '')}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${requireStripeSecretKey(env)}`,
      'stripe-version': env.STRIPE_API_VERSION?.trim() || DEFAULT_STRIPE_API_VERSION,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(toStripeErrorMessage(payload));
  }
  return payload;
};

const appendMetadata = (params: URLSearchParams, metadata: Record<string, string>) => {
  for (const [key, value] of Object.entries(metadata)) {
    params.set(`metadata[${key}]`, value);
  }
};

const appendNestedMetadata = (
  params: URLSearchParams,
  prefix: string,
  metadata: Record<string, string>,
) => {
  for (const [key, value] of Object.entries(metadata)) {
    params.set(`${prefix}[metadata][${key}]`, value);
  }
};

const readStripeIdAndUrl = (payload: unknown, errorMessage: string) => {
  const record = readObject(payload);
  const id = readString(record.id);
  const url = readString(record.url);
  if (!id || !url) {
    throw new Error(errorMessage);
  }
  return { id, url };
};

const createStripeCustomer = async ({
  env,
  name,
  email,
  metadata,
  idempotencyKey,
}: {
  env: BillingApiBindings;
  name: string;
  email: string | null;
  metadata: Record<string, string>;
  idempotencyKey: string;
}) => {
  const params = new URLSearchParams();
  params.set('name', name);
  if (email) {
    params.set('email', email);
  }
  appendMetadata(params, metadata);

  const payload = await postStripeForm({
    env,
    path: 'customers',
    params,
    idempotencyKey,
  });
  const id = readString(readObject(payload).id);
  if (!id) {
    throw new Error('Invalid Stripe customer response.');
  }
  return { id };
};

const createStripeSubscriptionCheckoutSession = async ({
  env,
  priceId,
  customerId,
  successUrl,
  cancelUrl,
  clientReferenceId,
  metadata,
  idempotencyKey,
}: {
  env: BillingApiBindings;
  priceId: string;
  customerId: string;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}) => {
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('customer', customerId);
  params.set('client_reference_id', clientReferenceId);
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  appendMetadata(params, metadata);
  appendNestedMetadata(params, 'subscription_data', metadata);

  return readStripeIdAndUrl(
    await postStripeForm({
      env,
      path: 'checkout/sessions',
      params,
      idempotencyKey,
    }),
    'Invalid Stripe subscription checkout session response.',
  );
};

const createStripeSetupCheckoutSession = async ({
  env,
  customerId,
  successUrl,
  cancelUrl,
  currency,
  clientReferenceId,
  metadata,
  idempotencyKey,
}: {
  env: BillingApiBindings;
  customerId: string;
  successUrl: string;
  cancelUrl: string;
  currency: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}) => {
  const params = new URLSearchParams();
  params.set('mode', 'setup');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('customer', customerId);
  params.set('currency', currency);
  params.set('client_reference_id', clientReferenceId);
  appendMetadata(params, metadata);

  return readStripeIdAndUrl(
    await postStripeForm({
      env,
      path: 'checkout/sessions',
      params,
      idempotencyKey,
    }),
    'Invalid Stripe setup checkout session response.',
  );
};

const createStripeBillingPortalSession = async ({
  env,
  customerId,
  returnUrl,
  idempotencyKey,
}: {
  env: BillingApiBindings;
  customerId: string;
  returnUrl: string;
  idempotencyKey: string;
}) => {
  const params = new URLSearchParams();
  params.set('customer', customerId);
  params.set('return_url', returnUrl);

  return readStripeIdAndUrl(
    await postStripeForm({
      env,
      path: 'billing_portal/sessions',
      params,
      idempotencyKey,
    }),
    'Invalid Stripe billing portal session response.',
  );
};

const jsonResponse = <TBody>(
  c: {
    json: (body: TBody, status?: never) => Response;
  },
  body: TBody,
  status = 200,
): Response => c.json(body, status as never);

const errorBody = (code: BillingApiErrorCode, message: string): BillingApiErrorResponse => ({
  error: { code, message },
});

const errorResponse = (
  c: {
    json: (body: BillingApiErrorResponse, status?: never) => Response;
  },
  status: number,
  code: BillingApiErrorCode,
  message: string,
): Response => jsonResponse(c, errorBody(code, message), status);

const readBearerToken = (authorization: string | undefined): string | null => {
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }
  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
};

const authenticateApp = async ({
  db,
  appId,
  apiKey,
}: {
  db: BillingApiDatabase;
  appId: string;
  apiKey: string;
}) => {
  const keyHash = await sha256Hex(apiKey);
  const credentialRows = await db
    .select({
      id: dbSchema.billingAppCredential.id,
      appId: dbSchema.billingAppCredential.appId,
    })
    .from(dbSchema.billingAppCredential)
    .where(
      and(
        eq(dbSchema.billingAppCredential.appId, appId),
        eq(dbSchema.billingAppCredential.keyHash, keyHash),
        isNull(dbSchema.billingAppCredential.revokedAt),
      ),
    )
    .limit(1);
  if (!credentialRows[0]) {
    return false;
  }

  const appRows = await db
    .select({ status: dbSchema.billingApp.status })
    .from(dbSchema.billingApp)
    .where(eq(dbSchema.billingApp.id, appId))
    .limit(1);
  return appRows[0]?.status === 'active';
};

const toSubjectResponse = (
  row: typeof dbSchema.billingSubject.$inferSelect,
): BillingApiSubject => ({
  appId: row.appId,
  subjectType: row.subjectType,
  subjectId: row.subjectId,
  status: row.status === 'archived' ? 'archived' : 'active',
  displayName: row.displayName,
  billingEmail: row.billingEmail ?? null,
  billingName: row.billingName ?? null,
  billingContacts: readBillingContacts(row.billingContactsJson),
  metadata: readObject(safeJsonParse(row.metadataJson, {})),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toAccountResponse = (
  row: typeof dbSchema.billingAccount.$inferSelect,
): BillingApiAccount => ({
  id: row.id,
  provider: 'stripe',
  providerCustomerId: row.providerCustomerId ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toSubscriptionResponse = (
  row: typeof dbSchema.billingSubscription.$inferSelect | null,
): BillingApiSubscription =>
  row
    ? {
        id: row.id,
        provider: 'stripe',
        providerSubscriptionId: row.providerSubscriptionId ?? null,
        planCode: row.planCode,
        priceCode: row.priceCode ?? null,
        providerPriceId: row.providerPriceId ?? null,
        priceResolution: normalizePriceResolution(row.priceResolution),
        interval: row.interval === 'month' || row.interval === 'year' ? row.interval : null,
        status:
          row.status === 'trialing' ||
          row.status === 'active' ||
          row.status === 'past_due' ||
          row.status === 'canceled' ||
          row.status === 'unpaid' ||
          row.status === 'incomplete'
            ? row.status
            : 'free',
        currentPeriodStart: toIso(row.currentPeriodStart),
        currentPeriodEnd: toIso(row.currentPeriodEnd),
        trialStart: toIso(row.trialStart),
        trialEnd: toIso(row.trialEnd),
        cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }
    : null;

const readEntitlementValue = (row: typeof dbSchema.billingEntitlement.$inferSelect): unknown =>
  row.valueType === 'none' ? null : safeJsonParse(row.valueJson, null);

const toEntitlementResponse = (
  row: typeof dbSchema.billingEntitlement.$inferSelect,
): BillingApiEntitlement => ({
  key: row.key,
  active: Boolean(row.active),
  valueType:
    row.valueType === 'number' ||
    row.valueType === 'string' ||
    row.valueType === 'json' ||
    row.valueType === 'none'
      ? row.valueType
      : 'boolean',
  value: readEntitlementValue(row),
  source:
    row.source === 'trial' ||
    row.source === 'paid' ||
    row.source === 'manual' ||
    row.source === 'admin_override'
      ? row.source
      : 'free',
  reason: row.reason,
  validFrom: toIso(row.validFrom),
  validUntil: toIso(row.validUntil),
  generatedAt: row.generatedAt.toISOString(),
});

const isEntitlementCurrentlyEffective = ({
  entitlement,
  timestamp,
}: {
  entitlement: typeof dbSchema.billingEntitlement.$inferSelect;
  timestamp: Date;
}) =>
  Boolean(entitlement.active) &&
  (!entitlement.validFrom || entitlement.validFrom.getTime() <= timestamp.getTime()) &&
  (!entitlement.validUntil || entitlement.validUntil.getTime() > timestamp.getTime());

export const buildBillingApiFeatures = ({
  entitlements,
  timestamp = now(),
}: {
  entitlements: (typeof dbSchema.billingEntitlement.$inferSelect)[];
  timestamp?: Date;
}): Record<string, unknown> =>
  Object.fromEntries(
    entitlements
      .filter((entitlement) => isEntitlementCurrentlyEffective({ entitlement, timestamp }))
      .map((entitlement) => [entitlement.key, readEntitlementValue(entitlement)]),
  );

const readSubjectBundle = async ({
  db,
  appId,
  subjectType,
  subjectId,
}: {
  db: BillingApiDatabase;
  appId: string;
  subjectType: string;
  subjectId: string;
}) => {
  const subjectRows = await db
    .select()
    .from(dbSchema.billingSubject)
    .where(
      and(
        eq(dbSchema.billingSubject.appId, appId),
        eq(dbSchema.billingSubject.subjectType, subjectType),
        eq(dbSchema.billingSubject.subjectId, subjectId),
      ),
    )
    .limit(1);
  const subject = subjectRows[0] ?? null;
  if (!subject) {
    return null;
  }

  const accountRows = await db
    .select()
    .from(dbSchema.billingAccount)
    .where(
      and(
        eq(dbSchema.billingAccount.appId, appId),
        eq(dbSchema.billingAccount.subjectRowId, subject.id),
      ),
    )
    .limit(1);
  const account = accountRows[0] ?? null;
  if (!account) {
    return null;
  }

  const [subscriptionRows, entitlementRows] = await Promise.all([
    db
      .select()
      .from(dbSchema.billingSubscription)
      .where(eq(dbSchema.billingSubscription.billingAccountId, account.id))
      .orderBy(desc(dbSchema.billingSubscription.updatedAt))
      .limit(1),
    db
      .select()
      .from(dbSchema.billingEntitlement)
      .where(
        and(
          eq(dbSchema.billingEntitlement.appId, appId),
          eq(dbSchema.billingEntitlement.subjectRowId, subject.id),
        ),
      ),
  ]);

  return {
    subject,
    account,
    subscription: subscriptionRows[0] ?? null,
    entitlements: entitlementRows,
  };
};

const buildEntitlementsResponse = ({
  env,
  appId,
  subjectType,
  subjectId,
  subscription,
  entitlements,
}: {
  env: BillingApiBindings;
  appId: string;
  subjectType: string;
  subjectId: string;
  subscription: typeof dbSchema.billingSubscription.$inferSelect | null;
  entitlements: (typeof dbSchema.billingEntitlement.$inferSelect)[];
}): BillingApiEntitlementsResponse => ({
  appId,
  subjectType,
  subjectId,
  planCode: subscription?.planCode ?? 'free',
  status: toSubscriptionResponse(subscription)?.status ?? 'free',
  priceResolution: normalizePriceResolution(subscription?.priceResolution),
  features: buildBillingApiFeatures({ entitlements }),
  entitlements: entitlements.map(toEntitlementResponse),
  syncedAt: now().toISOString(),
  maxStaleSeconds: parsePositiveInteger(env.BILLING_ENTITLEMENT_MAX_STALE_SECONDS, 3600),
});

const buildSummaryResponse = ({
  env,
  subject,
  account,
  subscription,
  entitlements,
}: {
  env: BillingApiBindings;
  subject: typeof dbSchema.billingSubject.$inferSelect;
  account: typeof dbSchema.billingAccount.$inferSelect;
  subscription: typeof dbSchema.billingSubscription.$inferSelect | null;
  entitlements: (typeof dbSchema.billingEntitlement.$inferSelect)[];
}): BillingApiSummaryResponse => ({
  subject: toSubjectResponse(subject),
  account: toAccountResponse(account),
  subscription: toSubscriptionResponse(subscription),
  entitlements: buildEntitlementsResponse({
    env,
    appId: subject.appId,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    subscription,
    entitlements,
  }),
});

const validateSubjectSyncBody = (body: unknown): BillingApiSubjectSyncRequest | null => {
  const record = readObject(body);
  const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : '';
  if (!displayName) {
    return null;
  }
  return {
    displayName,
    billingEmail:
      typeof record.billingEmail === 'string' && record.billingEmail.trim()
        ? record.billingEmail.trim().toLowerCase()
        : null,
    billingName:
      typeof record.billingName === 'string' && record.billingName.trim()
        ? record.billingName.trim()
        : null,
    billingContacts: normalizeContacts(record.billingContacts),
    metadata: readObject(record.metadata),
  };
};

const ensureSubject = async ({
  db,
  appId,
  subjectType,
  subjectId,
  body,
}: {
  db: BillingApiDatabase;
  appId: string;
  subjectType: string;
  subjectId: string;
  body: BillingApiSubjectSyncRequest;
}) => {
  const timestamp = now();
  const subjectRows = await db
    .select()
    .from(dbSchema.billingSubject)
    .where(
      and(
        eq(dbSchema.billingSubject.appId, appId),
        eq(dbSchema.billingSubject.subjectType, subjectType),
        eq(dbSchema.billingSubject.subjectId, subjectId),
      ),
    )
    .limit(1);
  const existingSubject = subjectRows[0] ?? null;
  const billingContactsJson = JSON.stringify(body.billingContacts ?? []);
  const metadataJson = JSON.stringify(body.metadata ?? {});

  if (existingSubject) {
    await db
      .update(dbSchema.billingParty)
      .set({
        displayName: body.billingName ?? body.displayName,
        primaryEmail: body.billingEmail ?? null,
        updatedAt: timestamp,
      })
      .where(eq(dbSchema.billingParty.id, existingSubject.partyId));
    await db
      .update(dbSchema.billingSubject)
      .set({
        status: 'active',
        displayName: body.displayName,
        billingEmail: body.billingEmail ?? null,
        billingName: body.billingName ?? null,
        billingContactsJson,
        metadataJson,
        updatedAt: timestamp,
      })
      .where(eq(dbSchema.billingSubject.id, existingSubject.id));

    const bundle = await readSubjectBundle({ db, appId, subjectType, subjectId });
    if (!bundle) {
      throw new Error('BILLING_SUBJECT_SYNC_FAILED');
    }
    return bundle;
  }

  const partyId = createId();
  const subjectRowId = createId();
  const accountId = createId();
  await db.insert(dbSchema.billingParty).values({
    id: partyId,
    displayName: body.billingName ?? body.displayName,
    primaryEmail: body.billingEmail ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(dbSchema.billingSubject).values({
    id: subjectRowId,
    appId,
    subjectType,
    subjectId,
    partyId,
    status: 'active',
    displayName: body.displayName,
    billingEmail: body.billingEmail ?? null,
    billingName: body.billingName ?? null,
    billingContactsJson,
    metadataJson,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(dbSchema.billingAccount).values({
    id: accountId,
    appId,
    subjectRowId,
    partyId,
    provider: 'stripe',
    billingEmail: body.billingEmail ?? null,
    billingName: body.billingName ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(dbSchema.billingSubscription).values({
    id: createId(),
    appId,
    billingAccountId: accountId,
    provider: 'stripe',
    planCode: 'free',
    priceResolution: 'not_applicable',
    status: 'free',
    cancelAtPeriodEnd: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const bundle = await readSubjectBundle({ db, appId, subjectType, subjectId });
  if (!bundle) {
    throw new Error('BILLING_SUBJECT_SYNC_FAILED');
  }
  return bundle;
};

const replaceEntitlementsFromRules = async ({
  db,
  appId,
  subjectRowId,
  accountId,
  planCode,
  source,
  reason,
  validUntil,
}: {
  db: BillingApiDatabase;
  appId: string;
  subjectRowId: string;
  accountId: string;
  planCode: string;
  source: 'trial' | 'paid';
  reason: string;
  validUntil: Date | null;
}) => {
  const timestamp = now();
  await db
    .delete(dbSchema.billingEntitlement)
    .where(
      and(
        eq(dbSchema.billingEntitlement.appId, appId),
        eq(dbSchema.billingEntitlement.subjectRowId, subjectRowId),
      ),
    );

  const rules = await db
    .select()
    .from(dbSchema.billingEntitlementRule)
    .where(
      and(
        eq(dbSchema.billingEntitlementRule.appId, appId),
        eq(dbSchema.billingEntitlementRule.planCode, planCode),
        eq(dbSchema.billingEntitlementRule.active, true),
      ),
    );
  if (rules.length === 0) {
    return;
  }

  await db.insert(dbSchema.billingEntitlement).values(
    rules.map((rule) => ({
      id: createId(),
      appId,
      subjectRowId,
      billingAccountId: accountId,
      key: rule.entitlementKey,
      active: true,
      valueType: rule.valueType,
      valueJson: rule.valueJson,
      source,
      reason,
      validFrom: timestamp,
      validUntil,
      generatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  );
};

const clearEntitlements = async ({
  db,
  appId,
  subjectRowId,
}: {
  db: BillingApiDatabase;
  appId: string;
  subjectRowId: string;
}) => {
  await db
    .delete(dbSchema.billingEntitlement)
    .where(
      and(
        eq(dbSchema.billingEntitlement.appId, appId),
        eq(dbSchema.billingEntitlement.subjectRowId, subjectRowId),
      ),
    );
};

const startLocalTrial = async ({
  db,
  env,
  appId,
  subjectType,
  subjectId,
}: {
  db: BillingApiDatabase;
  env: BillingApiBindings;
  appId: string;
  subjectType: string;
  subjectId: string;
}): Promise<JsonResult<BillingApiHandoffResponse | BillingApiErrorResponse>> => {
  const bundle = await readSubjectBundle({ db, appId, subjectType, subjectId });
  if (!bundle) {
    return { status: 404, body: errorBody('subject_not_found', 'Billing subject is not synced.') };
  }
  const subscription = toSubscriptionResponse(bundle.subscription);
  if (subscription && subscription.status !== 'free' && subscription.status !== 'canceled') {
    return {
      status: 409,
      body: {
        status: 'conflict',
        message: 'Subject already has an active billing lifecycle.',
        url: null,
        operationAttemptId: null,
        reused: false,
      },
    };
  }

  const trialStart = now();
  const trialEnd = new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  await db
    .update(dbSchema.billingSubscription)
    .set({
      planCode: 'premium',
      priceCode: null,
      providerPriceId: null,
      priceResolution: 'not_applicable',
      interval: null,
      status: 'trialing',
      trialStart,
      trialEnd,
      currentPeriodStart: trialStart,
      currentPeriodEnd: trialEnd,
      updatedAt: trialStart,
    })
    .where(eq(dbSchema.billingSubscription.id, bundle.subscription?.id ?? ''));
  await replaceEntitlementsFromRules({
    db,
    appId,
    subjectRowId: bundle.subject.id,
    accountId: bundle.account.id,
    planCode: 'premium',
    source: 'trial',
    reason: 'trial_started_by_billing_api',
    validUntil: trialEnd,
  });

  const latest = await readSubjectBundle({ db, appId, subjectType, subjectId });
  if (!latest) {
    return { status: 500, body: errorBody('internal_error', 'Failed to read trial state.') };
  }

  return {
    status: 200,
    body: {
      status: 'succeeded',
      message: `Started trial. Entitlements synced for ${parsePositiveInteger(
        env.BILLING_ENTITLEMENT_MAX_STALE_SECONDS,
        3600,
      )}s max stale windows.`,
      url: null,
      operationAttemptId: null,
      reused: false,
    },
  };
};

const completeLocalTrial = async ({
  db,
  appId,
  subjectType,
  subjectId,
}: {
  db: BillingApiDatabase;
  appId: string;
  subjectType: string;
  subjectId: string;
}): Promise<JsonResult<BillingApiHandoffResponse | BillingApiErrorResponse>> => {
  const bundle = await readSubjectBundle({ db, appId, subjectType, subjectId });
  if (!bundle) {
    return { status: 404, body: errorBody('subject_not_found', 'Billing subject is not synced.') };
  }
  const subscription = bundle.subscription;
  if (!subscription || subscription.status !== 'trialing' || !subscription.trialEnd) {
    return {
      status: 409,
      body: {
        status: 'conflict',
        message: 'Subject does not have an active trial.',
        url: null,
        operationAttemptId: null,
        reused: false,
      },
    };
  }
  if (subscription.trialEnd.getTime() > Date.now()) {
    return {
      status: 409,
      body: {
        status: 'conflict',
        message: 'Trial is not ready to complete.',
        url: null,
        operationAttemptId: null,
        reused: false,
      },
    };
  }

  const timestamp = now();
  await db
    .update(dbSchema.billingSubscription)
    .set({
      planCode: 'free',
      priceCode: null,
      providerPriceId: null,
      priceResolution: 'not_applicable',
      interval: null,
      status: 'free',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      updatedAt: timestamp,
    })
    .where(eq(dbSchema.billingSubscription.id, subscription.id));
  await clearEntitlements({ db, appId, subjectRowId: bundle.subject.id });

  return {
    status: 200,
    body: {
      status: 'succeeded',
      message: 'Trial completed and subject returned to free.',
      url: null,
      operationAttemptId: null,
      reused: false,
    },
  };
};

type BillingOperationPurpose =
  | 'create_subscription_checkout'
  | 'create_setup_checkout'
  | 'create_portal_session';

type HandoffRequest = Omit<
  BillingApiHandoffRequest,
  'actor' | 'planCode' | 'interval' | 'returnUrlKey' | 'returnUrlOverride'
> & {
  actor: BillingApiActor;
  planCode: string;
  interval: 'month' | 'year';
  returnUrlKey: string;
  returnUrlOverride: string | null;
};

const readActor = (value: unknown): BillingApiActor | null => {
  const record = readObject(value);
  const type = record.type === 'system' ? 'system' : record.type === 'user' ? 'user' : null;
  if (!type) {
    return null;
  }
  return {
    type,
    id: readString(record.id),
    email: readString(record.email),
  };
};

const validateHandoffRequest = ({
  body,
  env,
}: {
  body: unknown;
  env: BillingApiBindings;
}): HandoffRequest | null => {
  const record = readObject(body);
  const actor = readActor(record.actor);
  if (!actor) {
    return null;
  }
  const interval = record.interval === 'year' ? 'year' : 'month';
  return {
    actor,
    planCode: readString(record.planCode) ?? 'premium',
    interval,
    returnUrlKey:
      readString(record.returnUrlKey) ??
      readString(env.BILLING_DEFAULT_RETURN_URL_KEY) ??
      DEFAULT_RETURN_URL_KEY,
    returnUrlOverride: readString(record.returnUrlOverride),
  };
};

const validateUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
};

const resolveRedirectUrls = async ({
  db,
  env,
  appId,
  request,
}: {
  db: BillingApiDatabase;
  env: BillingApiBindings;
  appId: string;
  request: HandoffRequest;
}): Promise<JsonResult<BillingApiErrorResponse> | { successUrl: string; cancelUrl: string }> => {
  if (request.returnUrlOverride) {
    if (env.BILLING_RETURN_URL_OVERRIDE_ALLOWED !== 'true') {
      return {
        status: 400,
        body: errorBody('bad_request', 'Return URL override is not allowed.'),
      };
    }
    const overrideUrl = validateUrl(request.returnUrlOverride);
    if (!overrideUrl) {
      return {
        status: 400,
        body: errorBody('bad_request', 'Return URL override is invalid.'),
      };
    }
    return { successUrl: overrideUrl, cancelUrl: overrideUrl };
  }

  const rows = await db
    .select()
    .from(dbSchema.billingRedirectTemplate)
    .where(
      and(
        eq(dbSchema.billingRedirectTemplate.appId, appId),
        eq(dbSchema.billingRedirectTemplate.key, request.returnUrlKey),
      ),
    )
    .limit(1);
  const template = rows[0] ?? null;
  if (!template) {
    return {
      status: 400,
      body: errorBody('bad_request', 'Return URL template is not configured.'),
    };
  }
  return {
    successUrl: template.successUrl,
    cancelUrl: template.cancelUrl ?? template.successUrl,
  };
};

const readActivePrice = async ({
  db,
  appId,
  planCode,
  interval,
}: {
  db: BillingApiDatabase;
  appId: string;
  planCode: string;
  interval: 'month' | 'year';
}): Promise<
  | JsonResult<BillingApiErrorResponse>
  | {
      plan: typeof dbSchema.billingPlan.$inferSelect;
      price: typeof dbSchema.billingPrice.$inferSelect;
      providerPriceId: string;
    }
> => {
  const planRows = await db
    .select()
    .from(dbSchema.billingPlan)
    .where(
      and(
        eq(dbSchema.billingPlan.appId, appId),
        eq(dbSchema.billingPlan.code, planCode),
        eq(dbSchema.billingPlan.active, true),
      ),
    )
    .limit(1);
  const plan = planRows[0] ?? null;
  if (!plan) {
    return {
      status: 400,
      body: errorBody('bad_request', 'Billing plan is not configured.'),
    };
  }

  const priceRows = await db
    .select()
    .from(dbSchema.billingPrice)
    .where(
      and(
        eq(dbSchema.billingPrice.appId, appId),
        eq(dbSchema.billingPrice.planId, plan.id),
        eq(dbSchema.billingPrice.interval, interval),
        eq(dbSchema.billingPrice.active, true),
      ),
    )
    .limit(1);
  const price = priceRows[0] ?? null;
  const providerPriceId = price?.providerPriceId;
  if (!providerPriceId) {
    return {
      status: 503,
      body: errorBody('provider_not_configured', 'Stripe price is not configured.'),
    };
  }
  return { plan, price, providerPriceId };
};

const buildProviderIdempotencyKey = async ({
  appId,
  reuseKey,
  attemptNumber,
}: {
  appId: string;
  reuseKey: string;
  attemptNumber: number;
}) => `billing:${appId}:${await sha256Hex(`${reuseKey}:${attemptNumber}`)}`;

const buildHandoffReuseKey = ({
  purpose,
  subjectType,
  subjectId,
  planCode,
  interval,
}: {
  purpose: BillingOperationPurpose;
  subjectType: string;
  subjectId: string;
  planCode?: string;
  interval?: 'month' | 'year';
}) => {
  if (purpose === 'create_subscription_checkout') {
    return `${purpose}:${subjectType}:${subjectId}:${planCode ?? 'premium'}:${interval ?? 'month'}`;
  }
  if (purpose === 'create_setup_checkout') {
    return `${purpose}:${subjectType}:${subjectId}`;
  }
  return `${purpose}:${subjectType}:${subjectId}:default`;
};

const readReusableAttempt = async ({
  db,
  appId,
  billingAccountId,
  reuseKey,
  timestamp,
}: {
  db: BillingApiDatabase;
  appId: string;
  billingAccountId: string;
  reuseKey: string;
  timestamp: Date;
}) => {
  const rows = await db
    .select()
    .from(dbSchema.billingOperationAttempt)
    .where(
      and(
        eq(dbSchema.billingOperationAttempt.appId, appId),
        eq(dbSchema.billingOperationAttempt.billingAccountId, billingAccountId),
        eq(dbSchema.billingOperationAttempt.reuseKey, reuseKey),
        eq(dbSchema.billingOperationAttempt.state, 'succeeded'),
        gt(dbSchema.billingOperationAttempt.handoffExpiresAt, timestamp),
      ),
    )
    .orderBy(desc(dbSchema.billingOperationAttempt.createdAt))
    .limit(1);
  const attempt = rows[0] ?? null;
  return attempt?.handoffUrl ? attempt : null;
};

const readFreshProcessingAttempt = async ({
  db,
  appId,
  billingAccountId,
  reuseKey,
  timestamp,
}: {
  db: BillingApiDatabase;
  appId: string;
  billingAccountId: string;
  reuseKey: string;
  timestamp: Date;
}) => {
  const staleBefore = new Date(timestamp.getTime() - DEFAULT_OPERATION_PENDING_STALE_MS);
  const rows = await db
    .select()
    .from(dbSchema.billingOperationAttempt)
    .where(
      and(
        eq(dbSchema.billingOperationAttempt.appId, appId),
        eq(dbSchema.billingOperationAttempt.billingAccountId, billingAccountId),
        eq(dbSchema.billingOperationAttempt.reuseKey, reuseKey),
        eq(dbSchema.billingOperationAttempt.state, 'processing'),
        gt(dbSchema.billingOperationAttempt.createdAt, staleBefore),
      ),
    )
    .orderBy(desc(dbSchema.billingOperationAttempt.createdAt))
    .limit(1);
  return rows[0] ?? null;
};

const claimOperationAttempt = async ({
  db,
  appId,
  billingAccountId,
  purpose,
  reuseKey,
  actor,
}: {
  db: BillingApiDatabase;
  appId: string;
  billingAccountId: string;
  purpose: BillingOperationPurpose;
  reuseKey: string;
  actor: BillingApiActor;
}): Promise<
  | { kind: 'claimed'; attempt: typeof dbSchema.billingOperationAttempt.$inferSelect }
  | { kind: 'reused'; attempt: typeof dbSchema.billingOperationAttempt.$inferSelect }
  | { kind: 'processing'; attempt: typeof dbSchema.billingOperationAttempt.$inferSelect }
> => {
  const timestamp = now();
  const reusable = await readReusableAttempt({
    db,
    appId,
    billingAccountId,
    reuseKey,
    timestamp,
  });
  if (reusable) {
    return { kind: 'reused', attempt: reusable };
  }
  const processing = await readFreshProcessingAttempt({
    db,
    appId,
    billingAccountId,
    reuseKey,
    timestamp,
  });
  if (processing) {
    return { kind: 'processing', attempt: processing };
  }

  await db
    .update(dbSchema.billingOperationAttempt)
    .set({
      state: 'expired',
      failureReason: 'processing attempt exceeded freshness window',
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(dbSchema.billingOperationAttempt.appId, appId),
        eq(dbSchema.billingOperationAttempt.billingAccountId, billingAccountId),
        eq(dbSchema.billingOperationAttempt.reuseKey, reuseKey),
        eq(dbSchema.billingOperationAttempt.state, 'processing'),
        lt(
          dbSchema.billingOperationAttempt.createdAt,
          new Date(timestamp.getTime() - DEFAULT_OPERATION_PENDING_STALE_MS),
        ),
      ),
    );

  const attemptNumberRows = await db
    .select({
      attemptNumber: max(dbSchema.billingOperationAttempt.attemptNumber),
    })
    .from(dbSchema.billingOperationAttempt)
    .where(
      and(
        eq(dbSchema.billingOperationAttempt.appId, appId),
        eq(dbSchema.billingOperationAttempt.billingAccountId, billingAccountId),
        eq(dbSchema.billingOperationAttempt.reuseKey, reuseKey),
      ),
    );
  const attemptNumber = Number(attemptNumberRows[0]?.attemptNumber ?? 0) + 1;
  const idempotencyKey = await buildProviderIdempotencyKey({ appId, reuseKey, attemptNumber });
  const rows = await db
    .insert(dbSchema.billingOperationAttempt)
    .values({
      id: createId(),
      appId,
      billingAccountId,
      purpose,
      reuseKey,
      attemptNumber,
      idempotencyKey,
      state: 'processing',
      provider: 'stripe',
      actorType: actor.type,
      actorId: actor.id,
      actorEmail: actor.email ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  const attempt = rows[0];
  if (!attempt) {
    throw new Error('BILLING_OPERATION_ATTEMPT_CLAIM_FAILED');
  }
  return { kind: 'claimed', attempt };
};

const markOperationAttemptSucceeded = async ({
  db,
  attemptId,
  url,
  expiresAt,
  providerCustomerId,
  providerCheckoutSessionId,
  providerPortalSessionId,
}: {
  db: BillingApiDatabase;
  attemptId: string;
  url: string;
  expiresAt: Date;
  providerCustomerId: string | null;
  providerCheckoutSessionId?: string | null;
  providerPortalSessionId?: string | null;
}) => {
  await db
    .update(dbSchema.billingOperationAttempt)
    .set({
      state: 'succeeded',
      handoffUrl: url,
      handoffExpiresAt: expiresAt,
      providerCustomerId,
      providerCheckoutSessionId: providerCheckoutSessionId ?? null,
      providerPortalSessionId: providerPortalSessionId ?? null,
      failureReason: null,
      updatedAt: now(),
    })
    .where(eq(dbSchema.billingOperationAttempt.id, attemptId));
};

const markOperationAttemptFailed = async ({
  db,
  attemptId,
  failureReason,
}: {
  db: BillingApiDatabase;
  attemptId: string;
  failureReason: string;
}) => {
  await db
    .update(dbSchema.billingOperationAttempt)
    .set({
      state: 'failed',
      failureReason,
      updatedAt: now(),
    })
    .where(eq(dbSchema.billingOperationAttempt.id, attemptId));
};

const ensureStripeCustomer = async ({
  db,
  env,
  bundle,
  metadata,
  idempotencyKey,
}: {
  db: BillingApiDatabase;
  env: BillingApiBindings;
  bundle: NonNullable<Awaited<ReturnType<typeof readSubjectBundle>>>;
  metadata: Record<string, string>;
  idempotencyKey: string;
}) => {
  if (bundle.account.providerCustomerId) {
    return bundle.account.providerCustomerId;
  }
  const customer = await createStripeCustomer({
    env,
    name: bundle.subject.billingName ?? bundle.subject.displayName,
    email: bundle.subject.billingEmail ?? bundle.account.billingEmail ?? null,
    metadata,
    idempotencyKey,
  });
  await db
    .update(dbSchema.billingAccount)
    .set({
      providerCustomerId: customer.id,
      updatedAt: now(),
    })
    .where(eq(dbSchema.billingAccount.id, bundle.account.id));
  return customer.id;
};

const buildBillingMetadata = ({
  appId,
  subjectType,
  subjectId,
  billingAccountId,
  purpose,
  planCode,
  interval,
}: {
  appId: string;
  subjectType: string;
  subjectId: string;
  billingAccountId: string;
  purpose: string;
  planCode?: string;
  interval?: 'month' | 'year';
}): Record<string, string> => ({
  appId,
  subjectType,
  subjectId,
  billingAccountId,
  billingPurpose: purpose,
  ...(planCode ? { planCode } : {}),
  ...(interval ? { billingInterval: interval } : {}),
});

const toHandoffError = (error: unknown): JsonResult<BillingApiErrorResponse> =>
  error instanceof Error && error.message === 'STRIPE_NOT_CONFIGURED'
    ? {
        status: 503,
        body: errorBody('provider_not_configured', 'Stripe secret key is not configured.'),
      }
    : {
        status: 502,
        body: errorBody(
          'internal_error',
          error instanceof Error ? error.message : 'Stripe handoff failed.',
        ),
      };

const createCheckoutSessionHandoff = async ({
  db,
  env,
  appId,
  subjectType,
  subjectId,
  body,
}: {
  db: BillingApiDatabase;
  env: BillingApiBindings;
  appId: string;
  subjectType: string;
  subjectId: string;
  body: unknown;
}): Promise<JsonResult<BillingApiHandoffResponse | BillingApiErrorResponse>> => {
  const request = validateHandoffRequest({ body, env });
  if (!request) {
    return { status: 400, body: errorBody('bad_request', 'Valid actor is required.') };
  }
  const bundle = await readSubjectBundle({ db, appId, subjectType, subjectId });
  if (!bundle) {
    return { status: 404, body: errorBody('subject_not_found', 'Billing subject is not synced.') };
  }
  const priceResult = await readActivePrice({
    db,
    appId,
    planCode: request.planCode,
    interval: request.interval,
  });
  if ('status' in priceResult) {
    return priceResult;
  }
  const redirectUrls = await resolveRedirectUrls({ db, env, appId, request });
  if ('status' in redirectUrls) {
    return redirectUrls;
  }

  const reuseKey = buildHandoffReuseKey({
    purpose: 'create_subscription_checkout',
    subjectType,
    subjectId,
    planCode: request.planCode,
    interval: request.interval,
  });
  const claim = await claimOperationAttempt({
    db,
    appId,
    billingAccountId: bundle.account.id,
    purpose: 'create_subscription_checkout',
    reuseKey,
    actor: request.actor,
  });
  if (claim.kind === 'reused') {
    return {
      status: 200,
      body: {
        status: 'processing',
        message: 'Reused existing Stripe checkout session.',
        url: claim.attempt.handoffUrl,
        operationAttemptId: claim.attempt.id,
        reused: true,
      },
    };
  }
  if (claim.kind === 'processing') {
    return {
      status: 409,
      body: {
        status: 'conflict',
        message: 'Stripe checkout session is already being created.',
        url: null,
        operationAttemptId: claim.attempt.id,
        reused: false,
      },
    };
  }

  try {
    const metadata = buildBillingMetadata({
      appId,
      subjectType,
      subjectId,
      billingAccountId: bundle.account.id,
      purpose: 'subscription_checkout',
      planCode: request.planCode,
      interval: request.interval,
    });
    const customerId = await ensureStripeCustomer({
      db,
      env,
      bundle,
      metadata,
      idempotencyKey: `${claim.attempt.idempotencyKey}:customer`,
    });
    const session = await createStripeSubscriptionCheckoutSession({
      env,
      priceId: priceResult.providerPriceId,
      customerId,
      successUrl: redirectUrls.successUrl,
      cancelUrl: redirectUrls.cancelUrl,
      clientReferenceId: `${appId}:${subjectType}:${subjectId}`,
      metadata,
      idempotencyKey: `${claim.attempt.idempotencyKey}:checkout`,
    });
    const expiresAt = new Date(
      now().getTime() +
        parsePositiveInteger(env.BILLING_HANDOFF_REUSE_SECONDS, DEFAULT_HANDOFF_REUSE_SECONDS) *
          1000,
    );
    await markOperationAttemptSucceeded({
      db,
      attemptId: claim.attempt.id,
      url: session.url,
      expiresAt,
      providerCustomerId: customerId,
      providerCheckoutSessionId: session.id,
    });
    return {
      status: 200,
      body: {
        status: 'processing',
        message: 'Created Stripe checkout session.',
        url: session.url,
        operationAttemptId: claim.attempt.id,
        reused: false,
      },
    };
  } catch (error) {
    await markOperationAttemptFailed({
      db,
      attemptId: claim.attempt.id,
      failureReason: error instanceof Error ? error.message : 'Stripe checkout session failed.',
    });
    return toHandoffError(error);
  }
};

const createPaymentMethodSetupHandoff = async ({
  db,
  env,
  appId,
  subjectType,
  subjectId,
  body,
}: {
  db: BillingApiDatabase;
  env: BillingApiBindings;
  appId: string;
  subjectType: string;
  subjectId: string;
  body: unknown;
}): Promise<JsonResult<BillingApiHandoffResponse | BillingApiErrorResponse>> => {
  const request = validateHandoffRequest({ body, env });
  if (!request) {
    return { status: 400, body: errorBody('bad_request', 'Valid actor is required.') };
  }
  const bundle = await readSubjectBundle({ db, appId, subjectType, subjectId });
  if (!bundle) {
    return { status: 404, body: errorBody('subject_not_found', 'Billing subject is not synced.') };
  }
  const redirectUrls = await resolveRedirectUrls({ db, env, appId, request });
  if ('status' in redirectUrls) {
    return redirectUrls;
  }

  const reuseKey = buildHandoffReuseKey({
    purpose: 'create_setup_checkout',
    subjectType,
    subjectId,
  });
  const claim = await claimOperationAttempt({
    db,
    appId,
    billingAccountId: bundle.account.id,
    purpose: 'create_setup_checkout',
    reuseKey,
    actor: request.actor,
  });
  if (claim.kind === 'reused') {
    return {
      status: 200,
      body: {
        status: 'processing',
        message: 'Reused existing Stripe setup checkout session.',
        url: claim.attempt.handoffUrl,
        operationAttemptId: claim.attempt.id,
        reused: true,
      },
    };
  }
  if (claim.kind === 'processing') {
    return {
      status: 409,
      body: {
        status: 'conflict',
        message: 'Stripe setup checkout session is already being created.',
        url: null,
        operationAttemptId: claim.attempt.id,
        reused: false,
      },
    };
  }

  try {
    const metadata = buildBillingMetadata({
      appId,
      subjectType,
      subjectId,
      billingAccountId: bundle.account.id,
      purpose: 'payment_method_setup',
    });
    const customerId = await ensureStripeCustomer({
      db,
      env,
      bundle,
      metadata,
      idempotencyKey: `${claim.attempt.idempotencyKey}:customer`,
    });
    const session = await createStripeSetupCheckoutSession({
      env,
      customerId,
      successUrl: redirectUrls.successUrl,
      cancelUrl: redirectUrls.cancelUrl,
      currency: env.BILLING_DEFAULT_CURRENCY?.trim().toLowerCase() || 'jpy',
      clientReferenceId: `${appId}:${subjectType}:${subjectId}`,
      metadata,
      idempotencyKey: `${claim.attempt.idempotencyKey}:setup`,
    });
    const expiresAt = new Date(
      now().getTime() +
        parsePositiveInteger(env.BILLING_HANDOFF_REUSE_SECONDS, DEFAULT_HANDOFF_REUSE_SECONDS) *
          1000,
    );
    await markOperationAttemptSucceeded({
      db,
      attemptId: claim.attempt.id,
      url: session.url,
      expiresAt,
      providerCustomerId: customerId,
      providerCheckoutSessionId: session.id,
    });
    return {
      status: 200,
      body: {
        status: 'processing',
        message: 'Created Stripe setup checkout session.',
        url: session.url,
        operationAttemptId: claim.attempt.id,
        reused: false,
      },
    };
  } catch (error) {
    await markOperationAttemptFailed({
      db,
      attemptId: claim.attempt.id,
      failureReason: error instanceof Error ? error.message : 'Stripe setup checkout failed.',
    });
    return toHandoffError(error);
  }
};

const createBillingPortalHandoff = async ({
  db,
  env,
  appId,
  subjectType,
  subjectId,
  body,
}: {
  db: BillingApiDatabase;
  env: BillingApiBindings;
  appId: string;
  subjectType: string;
  subjectId: string;
  body: unknown;
}): Promise<JsonResult<BillingApiHandoffResponse | BillingApiErrorResponse>> => {
  const request = validateHandoffRequest({ body, env });
  if (!request) {
    return { status: 400, body: errorBody('bad_request', 'Valid actor is required.') };
  }
  const bundle = await readSubjectBundle({ db, appId, subjectType, subjectId });
  if (!bundle) {
    return { status: 404, body: errorBody('subject_not_found', 'Billing subject is not synced.') };
  }
  if (!bundle.account.providerCustomerId) {
    return {
      status: 409,
      body: {
        status: 'conflict',
        message: 'Stripe customer is not linked yet.',
        url: null,
        operationAttemptId: null,
        reused: false,
      },
    };
  }
  const redirectUrls = await resolveRedirectUrls({ db, env, appId, request });
  if ('status' in redirectUrls) {
    return redirectUrls;
  }

  const reuseKey = buildHandoffReuseKey({
    purpose: 'create_portal_session',
    subjectType,
    subjectId,
  });
  const claim = await claimOperationAttempt({
    db,
    appId,
    billingAccountId: bundle.account.id,
    purpose: 'create_portal_session',
    reuseKey,
    actor: request.actor,
  });
  if (claim.kind === 'reused') {
    return {
      status: 200,
      body: {
        status: 'processing',
        message: 'Reused existing Stripe billing portal session.',
        url: claim.attempt.handoffUrl,
        operationAttemptId: claim.attempt.id,
        reused: true,
      },
    };
  }
  if (claim.kind === 'processing') {
    return {
      status: 409,
      body: {
        status: 'conflict',
        message: 'Stripe billing portal session is already being created.',
        url: null,
        operationAttemptId: claim.attempt.id,
        reused: false,
      },
    };
  }

  try {
    const session = await createStripeBillingPortalSession({
      env,
      customerId: bundle.account.providerCustomerId,
      returnUrl: redirectUrls.successUrl,
      idempotencyKey: `${claim.attempt.idempotencyKey}:portal`,
    });
    const expiresAt = new Date(
      now().getTime() +
        parsePositiveInteger(env.BILLING_HANDOFF_REUSE_SECONDS, DEFAULT_HANDOFF_REUSE_SECONDS) *
          1000,
    );
    await markOperationAttemptSucceeded({
      db,
      attemptId: claim.attempt.id,
      url: session.url,
      expiresAt,
      providerCustomerId: bundle.account.providerCustomerId,
      providerPortalSessionId: session.id,
    });
    return {
      status: 200,
      body: {
        status: 'processing',
        message: 'Created Stripe billing portal session.',
        url: session.url,
        operationAttemptId: claim.attempt.id,
        reused: false,
      },
    };
  } catch (error) {
    await markOperationAttemptFailed({
      db,
      attemptId: claim.attempt.id,
      failureReason: error instanceof Error ? error.message : 'Stripe billing portal failed.',
    });
    return toHandoffError(error);
  }
};

const runIdempotent = async ({
  c,
  appId,
  rawBody,
  action,
}: {
  c: BillingApiContext;
  appId: string;
  rawBody: string;
  action: (parsedBody: unknown) => Promise<JsonResult<unknown>>;
}) => {
  const idempotencyKey = c.req.header('idempotency-key')?.trim();
  if (!idempotencyKey) {
    return errorResponse(c, 400, 'idempotency_key_required', 'Idempotency-Key header is required.');
  }

  const db = c.get('db');
  const path = new URL(c.req.url).pathname;
  const requestHash = await sha256Hex(`${c.req.method}\n${path}\n${rawBody}`);
  const existingRows = await db
    .select()
    .from(dbSchema.billingApiIdempotency)
    .where(
      and(
        eq(dbSchema.billingApiIdempotency.appId, appId),
        eq(dbSchema.billingApiIdempotency.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  const existing = existingRows[0] ?? null;
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return errorResponse(
        c,
        409,
        'idempotency_conflict',
        'Idempotency-Key was reused with a different request.',
      );
    }
    if (existing.responseJson && existing.statusCode) {
      return jsonResponse(c, safeJsonParse(existing.responseJson, {}), existing.statusCode);
    }
  } else {
    const ttlSeconds = parsePositiveInteger(
      c.env.BILLING_API_IDEMPOTENCY_TTL_SECONDS,
      24 * 60 * 60,
    );
    const timestamp = now();
    await db.insert(dbSchema.billingApiIdempotency).values({
      id: createId(),
      appId,
      idempotencyKey,
      method: c.req.method,
      path,
      requestHash,
      expiresAt: new Date(timestamp.getTime() + ttlSeconds * 1000),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const parsedBody = rawBody ? safeJsonParse(rawBody, null) : null;
  const result = await action(parsedBody);
  await db
    .update(dbSchema.billingApiIdempotency)
    .set({
      statusCode: result.status,
      responseJson: JSON.stringify(result.body),
      updatedAt: now(),
    })
    .where(
      and(
        eq(dbSchema.billingApiIdempotency.appId, appId),
        eq(dbSchema.billingApiIdempotency.idempotencyKey, idempotencyKey),
      ),
    );

  return jsonResponse(c, result.body, result.status);
};

const parseStripeSignatureHeader = (value: string | undefined) => {
  if (!value) {
    return null;
  }
  const parts = Object.fromEntries(
    value.split(',').map((part) => {
      const [key, content] = part.split('=');
      return [key, content];
    }),
  );
  return typeof parts.t === 'string' && typeof parts.v1 === 'string'
    ? { timestamp: parts.t, signature: parts.v1 }
    : null;
};

const verifyStripeSignature = async ({
  rawBody,
  signatureHeader,
  webhookSecret,
}: {
  rawBody: string;
  signatureHeader: string | undefined;
  webhookSecret: string | undefined;
}) => {
  if (!webhookSecret?.trim()) {
    return false;
  }
  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed) {
    return false;
  }
  const timestampSeconds = Number.parseInt(parsed.timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }
  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > 300) {
    return false;
  }
  const expected = await hmacSha256Hex({
    secret: webhookSecret,
    payload: `${parsed.timestamp}.${rawBody}`,
  });
  return expected === parsed.signature;
};

type StripeBillingEventProcessingResult = {
  received: true;
  duplicate?: boolean;
  ignored?: boolean;
  warning?: string;
};

type StripeBillingMetadata = {
  appId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  billingAccountId: string | null;
  planCode: string | null;
  interval: 'month' | 'year' | null;
};

type StripeSubscriptionSnapshot = {
  id: string;
  customerId: string | null;
  status: BillingApiSubscriptionStatus;
  providerPriceId: string | null;
  interval: 'month' | 'year' | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  cancelAt: Date | null;
  cancelAtPeriodEnd: boolean;
  metadata: StripeBillingMetadata;
};

const supportedStripeBillingEventTypes = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.payment_action_required',
]);

export const isSupportedStripeBillingEventType = (eventType: string): boolean =>
  supportedStripeBillingEventTypes.has(eventType);

const readStripeMetadata = (value: unknown): Record<string, string> => {
  const metadata = readObject(value);
  return Object.fromEntries(
    Object.entries(metadata)
      .map(([key, entry]) => [key, typeof entry === 'string' ? entry.trim() : ''])
      .filter(([, entry]) => entry.length > 0),
  );
};

const readStripeBillingMetadata = (object: Record<string, unknown>): StripeBillingMetadata => {
  const directMetadata = readStripeMetadata(object.metadata);
  const subscriptionDetails = readObject(object.subscription_details);
  const subscriptionMetadata = readStripeMetadata(subscriptionDetails.metadata);
  const metadata = { ...subscriptionMetadata, ...directMetadata };
  const interval =
    metadata.billingInterval === 'year'
      ? 'year'
      : metadata.billingInterval === 'month'
        ? 'month'
        : null;
  return {
    appId: metadata.appId ?? null,
    subjectType: metadata.subjectType ?? null,
    subjectId: metadata.subjectId ?? null,
    billingAccountId: metadata.billingAccountId ?? null,
    planCode: metadata.planCode ?? null,
    interval,
  };
};

const mergeStripeBillingMetadata = (
  primary: StripeBillingMetadata,
  fallback: StripeBillingMetadata | null,
): StripeBillingMetadata => ({
  appId: primary.appId ?? fallback?.appId ?? null,
  subjectType: primary.subjectType ?? fallback?.subjectType ?? null,
  subjectId: primary.subjectId ?? fallback?.subjectId ?? null,
  billingAccountId: primary.billingAccountId ?? fallback?.billingAccountId ?? null,
  planCode: primary.planCode ?? fallback?.planCode ?? null,
  interval: primary.interval ?? fallback?.interval ?? null,
});

const normalizeStripeSubscriptionStatus = (value: string | null): BillingApiSubscriptionStatus => {
  if (
    value === 'trialing' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'canceled' ||
    value === 'unpaid' ||
    value === 'incomplete'
  ) {
    return value;
  }
  return value === 'incomplete_expired' ? 'canceled' : 'incomplete';
};

const readFirstStripeSubscriptionItem = (subscription: Record<string, unknown>) => {
  const items = readObject(subscription.items);
  const data = Array.isArray(items.data) ? items.data : [];
  return readObject(data[0]);
};

export const readStripeSubscriptionSnapshot = (
  value: unknown,
): StripeSubscriptionSnapshot | null => {
  const subscription = readObject(value);
  const id = readString(subscription.id);
  if (!id) {
    return null;
  }
  const item = readFirstStripeSubscriptionItem(subscription);
  const price = readObject(item.price);
  const recurring = readObject(price.recurring);
  const interval =
    recurring.interval === 'year'
      ? 'year'
      : recurring.interval === 'month'
        ? 'month'
        : readStripeBillingMetadata(subscription).interval;
  return {
    id,
    customerId: readStripeExpandableId(subscription.customer),
    status: normalizeStripeSubscriptionStatus(readString(subscription.status)),
    providerPriceId: readString(price.id),
    interval,
    currentPeriodStart:
      toDateFromUnixSeconds(subscription.current_period_start) ??
      toDateFromUnixSeconds(item.current_period_start),
    currentPeriodEnd:
      toDateFromUnixSeconds(subscription.current_period_end) ??
      toDateFromUnixSeconds(item.current_period_end),
    trialStart: toDateFromUnixSeconds(subscription.trial_start),
    trialEnd: toDateFromUnixSeconds(subscription.trial_end),
    cancelAt: toDateFromUnixSeconds(subscription.cancel_at),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    metadata: readStripeBillingMetadata(subscription),
  };
};

const readStripeInvoiceSubscriptionId = (invoice: Record<string, unknown>): string | null => {
  const direct = readStripeExpandableId(invoice.subscription);
  if (direct) {
    return direct;
  }
  const parent = readObject(invoice.parent);
  const subscriptionDetails = readObject(parent.subscription_details);
  return readStripeExpandableId(subscriptionDetails.subscription);
};

const readStripeCheckoutSubscriptionId = (session: Record<string, unknown>): string | null =>
  readStripeExpandableId(session.subscription);

const readStripeEventObject = (payload: Record<string, unknown>): Record<string, unknown> =>
  readObject(readObject(payload.data).object);

const retrieveStripeSubscriptionSnapshot = async ({
  env,
  subscriptionId,
}: {
  env: BillingApiBindings;
  subscriptionId: string;
}) => {
  const payload = await getStripeJson({ env, path: `subscriptions/${subscriptionId}` });
  const snapshot = readStripeSubscriptionSnapshot(payload);
  if (!snapshot) {
    throw new Error('Invalid Stripe subscription response.');
  }
  return snapshot;
};

const readSubjectBundleByAccountId = async ({
  db,
  billingAccountId,
}: {
  db: BillingApiDatabase;
  billingAccountId: string;
}) => {
  const accountRows = await db
    .select()
    .from(dbSchema.billingAccount)
    .where(eq(dbSchema.billingAccount.id, billingAccountId))
    .limit(1);
  const account = accountRows[0] ?? null;
  if (!account) {
    return null;
  }
  const subjectRows = await db
    .select()
    .from(dbSchema.billingSubject)
    .where(eq(dbSchema.billingSubject.id, account.subjectRowId))
    .limit(1);
  const subject = subjectRows[0] ?? null;
  if (!subject) {
    return null;
  }
  return readSubjectBundle({
    db,
    appId: subject.appId,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
  });
};

const readSubjectBundleByProviderCustomerId = async ({
  db,
  providerCustomerId,
}: {
  db: BillingApiDatabase;
  providerCustomerId: string;
}) => {
  const accountRows = await db
    .select({ id: dbSchema.billingAccount.id })
    .from(dbSchema.billingAccount)
    .where(
      and(
        eq(dbSchema.billingAccount.provider, 'stripe'),
        eq(dbSchema.billingAccount.providerCustomerId, providerCustomerId),
      ),
    )
    .limit(1);
  return accountRows[0]?.id
    ? readSubjectBundleByAccountId({ db, billingAccountId: accountRows[0].id })
    : null;
};

const readSubjectBundleByProviderSubscriptionId = async ({
  db,
  providerSubscriptionId,
}: {
  db: BillingApiDatabase;
  providerSubscriptionId: string;
}) => {
  const subscriptionRows = await db
    .select({ billingAccountId: dbSchema.billingSubscription.billingAccountId })
    .from(dbSchema.billingSubscription)
    .where(
      and(
        eq(dbSchema.billingSubscription.provider, 'stripe'),
        eq(dbSchema.billingSubscription.providerSubscriptionId, providerSubscriptionId),
      ),
    )
    .limit(1);
  return subscriptionRows[0]?.billingAccountId
    ? readSubjectBundleByAccountId({
        db,
        billingAccountId: subscriptionRows[0].billingAccountId,
      })
    : null;
};

const resolveWebhookSubjectBundle = async ({
  db,
  metadata,
  providerCustomerId,
  providerSubscriptionId,
}: {
  db: BillingApiDatabase;
  metadata: StripeBillingMetadata;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
}) => {
  if (metadata.appId && metadata.subjectType && metadata.subjectId) {
    const bundle = await readSubjectBundle({
      db,
      appId: metadata.appId,
      subjectType: metadata.subjectType,
      subjectId: metadata.subjectId,
    });
    if (bundle) {
      return bundle;
    }
  }
  if (metadata.billingAccountId) {
    const bundle = await readSubjectBundleByAccountId({
      db,
      billingAccountId: metadata.billingAccountId,
    });
    if (bundle) {
      return bundle;
    }
  }
  if (providerSubscriptionId) {
    const bundle = await readSubjectBundleByProviderSubscriptionId({
      db,
      providerSubscriptionId,
    });
    if (bundle) {
      return bundle;
    }
  }
  if (providerCustomerId) {
    return readSubjectBundleByProviderCustomerId({ db, providerCustomerId });
  }
  return null;
};

const readPriceByProviderPriceId = async ({
  db,
  appId,
  providerPriceId,
}: {
  db: BillingApiDatabase;
  appId: string;
  providerPriceId: string;
}) => {
  const rows = await db
    .select({
      priceCode: dbSchema.billingPrice.code,
      interval: dbSchema.billingPrice.interval,
      planCode: dbSchema.billingPlan.code,
    })
    .from(dbSchema.billingPrice)
    .innerJoin(dbSchema.billingPlan, eq(dbSchema.billingPrice.planId, dbSchema.billingPlan.id))
    .where(
      and(
        eq(dbSchema.billingPrice.provider, 'stripe'),
        eq(dbSchema.billingPrice.appId, appId),
        eq(dbSchema.billingPrice.providerPriceId, providerPriceId),
        eq(dbSchema.billingPrice.active, true),
        eq(dbSchema.billingPlan.active, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

const syncEntitlementsForSubscription = async ({
  db,
  bundle,
  subscription,
  planCode,
  priceResolution,
}: {
  db: BillingApiDatabase;
  bundle: NonNullable<Awaited<ReturnType<typeof readSubjectBundle>>>;
  subscription: StripeSubscriptionSnapshot;
  planCode: string;
  priceResolution: BillingApiPriceResolution;
}) => {
  if (priceResolution === 'unknown' || planCode === 'free') {
    await clearEntitlements({ db, appId: bundle.subject.appId, subjectRowId: bundle.subject.id });
    return;
  }
  if (subscription.status === 'trialing') {
    await replaceEntitlementsFromRules({
      db,
      appId: bundle.subject.appId,
      subjectRowId: bundle.subject.id,
      accountId: bundle.account.id,
      planCode,
      source: 'trial',
      reason: 'stripe_subscription_trialing',
      validUntil: subscription.trialEnd ?? subscription.currentPeriodEnd,
    });
    return;
  }
  if (subscription.status === 'active') {
    await replaceEntitlementsFromRules({
      db,
      appId: bundle.subject.appId,
      subjectRowId: bundle.subject.id,
      accountId: bundle.account.id,
      planCode,
      source: 'paid',
      reason: 'stripe_subscription_active',
      validUntil: subscription.currentPeriodEnd,
    });
    return;
  }
  await clearEntitlements({ db, appId: bundle.subject.appId, subjectRowId: bundle.subject.id });
};

const upsertSubscriptionFromStripe = async ({
  db,
  bundle,
  subscription,
}: {
  db: BillingApiDatabase;
  bundle: NonNullable<Awaited<ReturnType<typeof readSubjectBundle>>>;
  subscription: StripeSubscriptionSnapshot;
}) => {
  const timestamp = now();
  const knownPrice = subscription.providerPriceId
    ? await readPriceByProviderPriceId({
        db,
        appId: bundle.subject.appId,
        providerPriceId: subscription.providerPriceId,
      })
    : null;
  const isCanceled = subscription.status === 'canceled';
  const planCode = isCanceled
    ? 'free'
    : (knownPrice?.planCode ?? subscription.metadata.planCode ?? 'premium');
  const priceResolution: BillingApiPriceResolution = isCanceled
    ? 'not_applicable'
    : subscription.providerPriceId
      ? knownPrice
        ? 'known'
        : 'unknown'
      : 'not_applicable';
  const interval = knownPrice?.interval ?? subscription.interval;

  if (subscription.customerId && subscription.customerId !== bundle.account.providerCustomerId) {
    await db
      .update(dbSchema.billingAccount)
      .set({
        providerCustomerId: subscription.customerId,
        updatedAt: timestamp,
      })
      .where(eq(dbSchema.billingAccount.id, bundle.account.id));
  }

  const values = {
    appId: bundle.subject.appId,
    billingAccountId: bundle.account.id,
    provider: 'stripe',
    providerSubscriptionId: subscription.id,
    planCode,
    priceCode: knownPrice?.priceCode ?? null,
    providerPriceId: subscription.providerPriceId,
    priceResolution,
    interval,
    status: isCanceled ? 'canceled' : subscription.status,
    currentPeriodStart: isCanceled ? null : subscription.currentPeriodStart,
    currentPeriodEnd: isCanceled ? null : subscription.currentPeriodEnd,
    trialStart: isCanceled ? null : subscription.trialStart,
    trialEnd: isCanceled ? null : subscription.trialEnd,
    cancelAt: subscription.cancelAt,
    cancelAtPeriodEnd: isCanceled ? false : subscription.cancelAtPeriodEnd,
    updatedAt: timestamp,
  };

  if (bundle.subscription) {
    await db
      .update(dbSchema.billingSubscription)
      .set(values)
      .where(eq(dbSchema.billingSubscription.id, bundle.subscription.id));
  } else {
    await db.insert(dbSchema.billingSubscription).values({
      id: createId(),
      ...values,
      createdAt: timestamp,
    });
  }

  await syncEntitlementsForSubscription({
    db,
    bundle,
    subscription,
    planCode,
    priceResolution,
  });
  return { priceResolution };
};

const markProviderEvent = async ({
  db,
  eventId,
  processingStatus,
  receiptStatus,
  billingAccountId,
  providerCustomerId,
  providerSubscriptionId,
  failureReason = null,
  processedAt = now(),
}: {
  db: BillingApiDatabase;
  eventId: string;
  processingStatus: string;
  receiptStatus: string;
  billingAccountId?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  failureReason?: string | null;
  processedAt?: Date | null;
}) => {
  await db
    .update(dbSchema.billingProviderEvent)
    .set({
      processingStatus,
      receiptStatus,
      billingAccountId: billingAccountId ?? null,
      providerCustomerId: providerCustomerId ?? null,
      providerSubscriptionId: providerSubscriptionId ?? null,
      failureReason,
      processedAt,
      updatedAt: now(),
    })
    .where(
      and(
        eq(dbSchema.billingProviderEvent.provider, 'stripe'),
        eq(dbSchema.billingProviderEvent.providerEventId, eventId),
        eq(dbSchema.billingProviderEvent.scope, 'billing'),
      ),
    );
};

const claimProviderEvent = async ({
  db,
  eventId,
  eventType,
  payloadHash,
}: {
  db: BillingApiDatabase;
  eventId: string;
  eventType: string;
  payloadHash: string;
}): Promise<'claimed' | 'duplicate'> => {
  const timestamp = now();
  const inserted = await db
    .insert(dbSchema.billingProviderEvent)
    .values({
      id: createId(),
      provider: 'stripe',
      providerEventId: eventId,
      eventType,
      scope: 'billing',
      payloadHash,
      processingStatus: 'processing',
      receiptStatus: 'verified',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .returning({ id: dbSchema.billingProviderEvent.id });
  if (inserted[0]) {
    return 'claimed';
  }

  const rows = await db
    .select()
    .from(dbSchema.billingProviderEvent)
    .where(
      and(
        eq(dbSchema.billingProviderEvent.provider, 'stripe'),
        eq(dbSchema.billingProviderEvent.providerEventId, eventId),
        eq(dbSchema.billingProviderEvent.scope, 'billing'),
      ),
    )
    .limit(1);
  const existing = rows[0] ?? null;
  if (existing?.processingStatus === 'failed') {
    await db
      .update(dbSchema.billingProviderEvent)
      .set({
        eventType,
        payloadHash,
        processingStatus: 'processing',
        receiptStatus: 'verified',
        failureReason: null,
        processedAt: null,
        updatedAt: timestamp,
      })
      .where(eq(dbSchema.billingProviderEvent.id, existing.id));
    return 'claimed';
  }
  return 'duplicate';
};

const resolveSubscriptionSnapshotForEvent = async ({
  env,
  eventType,
  object,
}: {
  env: BillingApiBindings;
  eventType: string;
  object: Record<string, unknown>;
}): Promise<StripeSubscriptionSnapshot | null> => {
  if (eventType.startsWith('customer.subscription.')) {
    const fallback = readStripeSubscriptionSnapshot(object);
    if (fallback?.id && env.STRIPE_SECRET_KEY?.trim()) {
      try {
        return await retrieveStripeSubscriptionSnapshot({ env, subscriptionId: fallback.id });
      } catch {
        return fallback;
      }
    }
    return fallback;
  }

  const subscriptionId =
    eventType === 'checkout.session.completed'
      ? readStripeCheckoutSubscriptionId(object)
      : readStripeInvoiceSubscriptionId(object);
  return subscriptionId ? retrieveStripeSubscriptionSnapshot({ env, subscriptionId }) : null;
};

const handleStripeBillingWebhookEvent = async ({
  db,
  env,
  rawBody,
}: {
  db: BillingApiDatabase;
  env: BillingApiBindings;
  rawBody: string;
}): Promise<JsonResult<StripeBillingEventProcessingResult | BillingApiErrorResponse>> => {
  const payload = readObject(safeJsonParse(rawBody, {}));
  const eventId = readString(payload.id) ?? `unknown_${createId()}`;
  const eventType = readString(payload.type) ?? 'unknown';
  const payloadHash = await sha256Hex(rawBody);
  const claim = await claimProviderEvent({ db, eventId, eventType, payloadHash });
  if (claim === 'duplicate') {
    return { status: 200, body: { received: true, duplicate: true } };
  }

  const object = readStripeEventObject(payload);
  if (!supportedStripeBillingEventTypes.has(eventType)) {
    await markProviderEvent({
      db,
      eventId,
      processingStatus: 'ignored',
      receiptStatus: 'verified',
      failureReason: 'not_billing_event',
    });
    return { status: 200, body: { received: true, ignored: true } };
  }

  const objectMetadata = readStripeBillingMetadata(object);
  const objectCustomerId = readStripeExpandableId(object.customer);
  const objectSubscriptionId =
    eventType === 'checkout.session.completed'
      ? readStripeCheckoutSubscriptionId(object)
      : eventType.startsWith('invoice.')
        ? readStripeInvoiceSubscriptionId(object)
        : readString(object.id);

  let subscription: StripeSubscriptionSnapshot | null = null;
  try {
    subscription = await resolveSubscriptionSnapshotForEvent({ env, eventType, object });
  } catch (error) {
    await markProviderEvent({
      db,
      eventId,
      processingStatus: 'failed',
      receiptStatus: 'verified',
      providerCustomerId: objectCustomerId,
      providerSubscriptionId: objectSubscriptionId,
      failureReason:
        error instanceof Error && error.message === 'STRIPE_NOT_CONFIGURED'
          ? 'stripe_secret_key_not_configured'
          : 'stripe_subscription_lookup_failed',
      processedAt: null,
    });
    return error instanceof Error && error.message === 'STRIPE_NOT_CONFIGURED'
      ? {
          status: 503,
          body: errorBody('provider_not_configured', 'Stripe secret key is not configured.'),
        }
      : {
          status: 500,
          body: errorBody('internal_error', 'Stripe subscription state could not be reconciled.'),
        };
  }

  const metadata = mergeStripeBillingMetadata(objectMetadata, subscription?.metadata ?? null);
  const providerCustomerId = subscription?.customerId ?? objectCustomerId;
  const providerSubscriptionId = subscription?.id ?? objectSubscriptionId;
  const bundle = await resolveWebhookSubjectBundle({
    db,
    metadata,
    providerCustomerId,
    providerSubscriptionId,
  });

  if (!bundle) {
    await markProviderEvent({
      db,
      eventId,
      processingStatus: 'processed_with_warning',
      receiptStatus: 'verified',
      providerCustomerId,
      providerSubscriptionId,
      failureReason: 'billing_subject_not_found',
    });
    return { status: 200, body: { received: true, warning: 'billing_subject_not_found' } };
  }

  if (eventType === 'checkout.session.completed' && providerCustomerId) {
    await db
      .update(dbSchema.billingAccount)
      .set({ providerCustomerId, updatedAt: now() })
      .where(eq(dbSchema.billingAccount.id, bundle.account.id));
  }

  if (!subscription) {
    await markProviderEvent({
      db,
      eventId,
      processingStatus: 'processed_with_warning',
      receiptStatus: 'verified',
      billingAccountId: bundle.account.id,
      providerCustomerId,
      providerSubscriptionId,
      failureReason: 'stripe_subscription_missing',
    });
    return { status: 200, body: { received: true, warning: 'stripe_subscription_missing' } };
  }

  const syncResult = await upsertSubscriptionFromStripe({ db, bundle, subscription });
  const warning =
    syncResult.priceResolution === 'unknown' ? 'stripe_price_id_not_in_catalog' : undefined;
  await markProviderEvent({
    db,
    eventId,
    processingStatus: warning ? 'processed_with_warning' : 'processed',
    receiptStatus: 'verified',
    billingAccountId: bundle.account.id,
    providerCustomerId: subscription.customerId,
    providerSubscriptionId: subscription.id,
    failureReason: warning ?? null,
  });
  return { status: 200, body: { received: true, ...(warning ? { warning } : {}) } };
};

export const createBillingApiApp = () => {
  const app = new Hono<{
    Bindings: BillingApiBindings;
    Variables: BillingApiVariables;
  }>();

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.use('/api/v1/apps/:appId/*', async (c, next) => {
    const db = createBillingApiDatabase(c.env.DB);
    const appId = c.req.param('appId');
    const token = readBearerToken(c.req.header('authorization'));
    if (!token) {
      return errorResponse(c, 401, 'unauthorized', 'Billing API key is required.');
    }
    if (!(await authenticateApp({ db, appId, apiKey: token }))) {
      return errorResponse(c, 403, 'forbidden_app', 'Billing API key cannot access this app.');
    }
    c.set('db', db);
    c.set('appId', appId);
    await next();
  });

  app.put('/api/v1/apps/:appId/subjects/:subjectType/:subjectId', async (c) => {
    const rawBody = await c.req.text();
    return runIdempotent({
      c,
      appId: c.get('appId'),
      rawBody,
      action: async (parsedBody) => {
        const body = validateSubjectSyncBody(parsedBody);
        if (!body) {
          return {
            status: 400,
            body: errorBody('bad_request', 'displayName is required.'),
          };
        }
        const bundle = await ensureSubject({
          db: c.get('db'),
          appId: c.get('appId'),
          subjectType: c.req.param('subjectType'),
          subjectId: c.req.param('subjectId'),
          body,
        });
        return {
          status: 200,
          body: buildSummaryResponse({
            env: c.env,
            subject: bundle.subject,
            account: bundle.account,
            subscription: bundle.subscription,
            entitlements: bundle.entitlements,
          }),
        };
      },
    });
  });

  app.get('/api/v1/apps/:appId/subjects/:subjectType/:subjectId/summary', async (c) => {
    const bundle = await readSubjectBundle({
      db: c.get('db'),
      appId: c.get('appId'),
      subjectType: c.req.param('subjectType'),
      subjectId: c.req.param('subjectId'),
    });
    if (!bundle) {
      return errorResponse(c, 404, 'subject_not_found', 'Billing subject is not synced.');
    }
    return jsonResponse(
      c,
      buildSummaryResponse({
        env: c.env,
        subject: bundle.subject,
        account: bundle.account,
        subscription: bundle.subscription,
        entitlements: bundle.entitlements,
      }),
    );
  });

  app.get('/api/v1/apps/:appId/subjects/:subjectType/:subjectId/entitlements', async (c) => {
    const bundle = await readSubjectBundle({
      db: c.get('db'),
      appId: c.get('appId'),
      subjectType: c.req.param('subjectType'),
      subjectId: c.req.param('subjectId'),
    });
    if (!bundle) {
      return errorResponse(c, 404, 'subject_not_found', 'Billing subject is not synced.');
    }
    return jsonResponse(
      c,
      buildEntitlementsResponse({
        env: c.env,
        appId: c.get('appId'),
        subjectType: c.req.param('subjectType'),
        subjectId: c.req.param('subjectId'),
        subscription: bundle.subscription,
        entitlements: bundle.entitlements,
      }),
    );
  });

  app.post('/api/v1/apps/:appId/subjects/:subjectType/:subjectId/trial', async (c) => {
    const rawBody = await c.req.text();
    return runIdempotent({
      c,
      appId: c.get('appId'),
      rawBody,
      action: async () =>
        startLocalTrial({
          db: c.get('db'),
          env: c.env,
          appId: c.get('appId'),
          subjectType: c.req.param('subjectType'),
          subjectId: c.req.param('subjectId'),
        }),
    });
  });

  app.post('/api/v1/apps/:appId/subjects/:subjectType/:subjectId/trial/complete', async (c) => {
    const rawBody = await c.req.text();
    return runIdempotent({
      c,
      appId: c.get('appId'),
      rawBody,
      action: async () =>
        completeLocalTrial({
          db: c.get('db'),
          appId: c.get('appId'),
          subjectType: c.req.param('subjectType'),
          subjectId: c.req.param('subjectId'),
        }),
    });
  });

  app.post('/api/v1/apps/:appId/subjects/:subjectType/:subjectId/checkout-sessions', async (c) => {
    const rawBody = await c.req.text();
    return runIdempotent({
      c,
      appId: c.get('appId'),
      rawBody,
      action: async (parsedBody) =>
        createCheckoutSessionHandoff({
          db: c.get('db'),
          env: c.env,
          appId: c.get('appId'),
          subjectType: c.req.param('subjectType'),
          subjectId: c.req.param('subjectId'),
          body: parsedBody,
        }),
    });
  });

  app.post(
    '/api/v1/apps/:appId/subjects/:subjectType/:subjectId/payment-method-setup-sessions',
    async (c) => {
      const rawBody = await c.req.text();
      return runIdempotent({
        c,
        appId: c.get('appId'),
        rawBody,
        action: async (parsedBody) =>
          createPaymentMethodSetupHandoff({
            db: c.get('db'),
            env: c.env,
            appId: c.get('appId'),
            subjectType: c.req.param('subjectType'),
            subjectId: c.req.param('subjectId'),
            body: parsedBody,
          }),
      });
    },
  );

  app.post(
    '/api/v1/apps/:appId/subjects/:subjectType/:subjectId/billing-portal-sessions',
    async (c) => {
      const rawBody = await c.req.text();
      return runIdempotent({
        c,
        appId: c.get('appId'),
        rawBody,
        action: async (parsedBody) =>
          createBillingPortalHandoff({
            db: c.get('db'),
            env: c.env,
            appId: c.get('appId'),
            subjectType: c.req.param('subjectType'),
            subjectId: c.req.param('subjectId'),
            body: parsedBody,
          }),
      });
    },
  );

  app.post('/api/v1/webhooks/stripe/billing', async (c) => {
    const rawBody = await c.req.text();
    const verified = await verifyStripeSignature({
      rawBody,
      signatureHeader: c.req.header('stripe-signature'),
      webhookSecret: c.env.STRIPE_WEBHOOK_SECRET,
    });
    if (!verified) {
      return errorResponse(c, 400, 'unauthorized', 'Invalid Stripe signature.');
    }

    const db = createBillingApiDatabase(c.env.DB);
    const result = await handleStripeBillingWebhookEvent({ db, env: c.env, rawBody });
    return jsonResponse(c, result.body, result.status);
  });

  app.notFound((c) => errorResponse(c, 404, 'bad_request', 'Route not found.'));

  return app;
};
