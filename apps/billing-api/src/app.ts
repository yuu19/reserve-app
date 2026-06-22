import type {
  BillingApiAccount,
  BillingApiBillingContact,
  BillingApiEntitlement,
  BillingApiEntitlementsResponse,
  BillingApiErrorCode,
  BillingApiErrorResponse,
  BillingApiHandoffResponse,
  BillingApiSubject,
  BillingApiSubjectSyncRequest,
  BillingApiSummaryResponse,
  BillingApiSubscription,
} from '@repo/billing-types';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { createBillingApiDatabase, type BillingApiDatabase } from './db/database.js';
import * as dbSchema from './db/schema.js';

type BillingApiBindings = {
  DB: D1Database;
  BILLING_ENTITLEMENT_MAX_STALE_SECONDS?: string;
  BILLING_API_IDEMPOTENCY_TTL_SECONDS?: string;
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

const toIso = (value: Date | null | undefined): string | null =>
  value instanceof Date ? value.toISOString() : null;

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
  value: row.valueType === 'none' ? null : safeJsonParse(row.valueJson, null),
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

const unsupportedProviderHandoff = (): JsonResult<BillingApiErrorResponse> => ({
  status: 501,
  body: errorBody(
    'not_implemented',
    'This Billing API route is reserved for the MVP parity surface; Stripe handoff migration is not wired in this slice.',
  ),
});

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

  for (const path of [
    '/api/v1/apps/:appId/subjects/:subjectType/:subjectId/checkout-sessions',
    '/api/v1/apps/:appId/subjects/:subjectType/:subjectId/payment-method-setup-sessions',
    '/api/v1/apps/:appId/subjects/:subjectType/:subjectId/billing-portal-sessions',
  ]) {
    app.post(path, async (c) => {
      const rawBody = await c.req.text();
      return runIdempotent({
        c,
        appId: c.get('appId'),
        rawBody,
        action: async () => unsupportedProviderHandoff(),
      });
    });
  }

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

    const payload = readObject(safeJsonParse(rawBody, {}));
    const eventId = typeof payload.id === 'string' ? payload.id : `unknown_${createId()}`;
    const eventType = typeof payload.type === 'string' ? payload.type : 'unknown';
    const payloadHash = await sha256Hex(rawBody);
    const db = createBillingApiDatabase(c.env.DB);
    const timestamp = now();

    await db
      .insert(dbSchema.billingProviderEvent)
      .values({
        id: createId(),
        provider: 'stripe',
        providerEventId: eventId,
        eventType,
        scope: 'billing',
        payloadHash,
        processingStatus: 'received',
        receiptStatus: 'verified',
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoNothing();

    return c.json({ received: true });
  });

  app.notFound((c) => errorResponse(c, 404, 'bad_request', 'Route not found.'));

  return app;
};
