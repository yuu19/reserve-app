import {
  BILLING_OPERATION_PENDING_STALE_MS,
  buildBillingOperationIdempotencyKey,
  buildSubscriptionCheckoutReuseKey,
  type BillingOperationReuseKey,
} from '@repo/saas-billing-core';
import { describe, expect, it } from 'vitest';
import type { DrizzleBillingDatabase } from './database.js';
import { createDrizzleBillingEventStore } from './event-store.js';
import { createDrizzleBillingOperationStore } from './operation-store.js';
import {
  billingAccount,
  billingEntitlement,
  billingInvoiceEvent,
  billingOperationAttempt,
  billingPaymentIssue,
  billingProviderEvent,
  billingSubscription,
} from './schema.js';
import { createDrizzleBillingStore } from './store.js';

type SqlLike = {
  queryChunks: unknown[];
};

const createBillingAccountRow = (
  value: typeof billingAccount.$inferInsert,
): typeof billingAccount.$inferSelect => ({
  id: value.id,
  subjectType: value.subjectType,
  subjectId: value.subjectId,
  provider: value.provider,
  providerCustomerId: value.providerCustomerId ?? null,
  billingEmail: value.billingEmail ?? null,
  billingName: value.billingName ?? null,
  createdAt: value.createdAt ?? new Date(),
  updatedAt: value.updatedAt ?? new Date(),
});

const createBillingSubscriptionRow = (
  value: typeof billingSubscription.$inferInsert,
): typeof billingSubscription.$inferSelect => ({
  id: value.id,
  billingAccountId: value.billingAccountId,
  provider: value.provider,
  providerSubscriptionId: value.providerSubscriptionId ?? null,
  providerScheduleId: value.providerScheduleId ?? null,
  planCode: value.planCode,
  priceCode: value.priceCode ?? null,
  interval: value.interval ?? null,
  status: value.status,
  currentPeriodStart: value.currentPeriodStart ?? null,
  currentPeriodEnd: value.currentPeriodEnd ?? null,
  trialStart: value.trialStart ?? null,
  trialEnd: value.trialEnd ?? null,
  cancelAt: value.cancelAt ?? null,
  cancelAtPeriodEnd: value.cancelAtPeriodEnd ?? false,
  createdAt: value.createdAt ?? new Date(),
  updatedAt: value.updatedAt ?? new Date(),
});

const createBillingEntitlementRow = (
  value: typeof billingEntitlement.$inferInsert,
): typeof billingEntitlement.$inferSelect => ({
  id: value.id,
  billingAccountId: value.billingAccountId,
  key: value.key,
  active: value.active,
  source: value.source,
  reason: value.reason,
  validFrom: value.validFrom ?? null,
  validUntil: value.validUntil ?? null,
  createdAt: value.createdAt ?? new Date(),
  updatedAt: value.updatedAt ?? new Date(),
});

const createBillingPaymentIssueRow = (
  value: typeof billingPaymentIssue.$inferInsert,
): typeof billingPaymentIssue.$inferSelect => ({
  id: value.id,
  billingAccountId: value.billingAccountId,
  billingSubscriptionId: value.billingSubscriptionId ?? null,
  state: value.state,
  issueStartedAt: value.issueStartedAt ?? null,
  issueStartedAtSource: value.issueStartedAtSource,
  pastDueGraceEndsAt: value.pastDueGraceEndsAt ?? null,
  latestProviderEventId: value.latestProviderEventId ?? null,
  latestInvoiceId: value.latestInvoiceId ?? null,
  latestPaymentIntentId: value.latestPaymentIntentId ?? null,
  createdAt: value.createdAt ?? new Date(),
  updatedAt: value.updatedAt ?? new Date(),
});

const createBillingInvoiceEventRow = (
  value: typeof billingInvoiceEvent.$inferInsert,
): typeof billingInvoiceEvent.$inferSelect => ({
  id: value.id,
  billingAccountId: value.billingAccountId,
  billingSubscriptionId: value.billingSubscriptionId ?? null,
  eventType: value.eventType,
  provider: value.provider,
  providerEventId: value.providerEventId ?? null,
  providerInvoiceId: value.providerInvoiceId ?? null,
  providerPaymentIntentId: value.providerPaymentIntentId ?? null,
  providerStatus: value.providerStatus ?? null,
  ownerFacingStatus: value.ownerFacingStatus ?? null,
  occurredAt: value.occurredAt ?? null,
  createdAt: value.createdAt ?? new Date(),
});

const createBillingProviderEventRow = (
  value: typeof billingProviderEvent.$inferInsert,
): typeof billingProviderEvent.$inferSelect => ({
  id: value.id,
  provider: value.provider,
  providerEventId: value.providerEventId,
  eventType: value.eventType,
  scope: value.scope,
  payloadHash: value.payloadHash,
  processingStatus: value.processingStatus,
  receiptStatus: value.receiptStatus,
  duplicateDetected: value.duplicateDetected ?? false,
  duplicateDetectedAt: value.duplicateDetectedAt ?? null,
  attemptCount: value.attemptCount ?? 1,
  processingStartedAt: value.processingStartedAt ?? null,
  lastAttemptAt: value.lastAttemptAt ?? null,
  processingStaleAfterMs: value.processingStaleAfterMs,
  failureReason: value.failureReason ?? null,
  failureStage: value.failureStage ?? null,
  lastFailureReason: value.lastFailureReason ?? null,
  lastFailureAt: value.lastFailureAt ?? null,
  billingAccountId: value.billingAccountId ?? null,
  providerCustomerId: value.providerCustomerId ?? null,
  providerSubscriptionId: value.providerSubscriptionId ?? null,
  createdAt: value.createdAt ?? new Date(),
  updatedAt: value.updatedAt ?? new Date(),
  processedAt: value.processedAt ?? null,
});

const createBillingOperationAttemptRow = (
  value: typeof billingOperationAttempt.$inferInsert,
): typeof billingOperationAttempt.$inferSelect => ({
  id: value.id,
  billingAccountId: value.billingAccountId,
  purpose: value.purpose,
  reuseKey: value.reuseKey,
  attemptNumber: value.attemptNumber,
  idempotencyKey: value.idempotencyKey,
  state: value.state,
  handoffUrl: value.handoffUrl ?? null,
  handoffExpiresAt: value.handoffExpiresAt ?? null,
  provider: value.provider,
  providerCustomerId: value.providerCustomerId ?? null,
  providerSubscriptionId: value.providerSubscriptionId ?? null,
  providerCheckoutSessionId: value.providerCheckoutSessionId ?? null,
  providerPortalSessionId: value.providerPortalSessionId ?? null,
  failureReason: value.failureReason ?? null,
  createdByUserId: value.createdByUserId ?? null,
  createdAt: value.createdAt ?? new Date(),
  updatedAt: value.updatedAt ?? new Date(),
});

const columnKeys = new Map<unknown, string>([
  [billingAccount.id, 'id'],
  [billingAccount.subjectType, 'subjectType'],
  [billingAccount.subjectId, 'subjectId'],
  [billingAccount.provider, 'provider'],
  [billingAccount.providerCustomerId, 'providerCustomerId'],
  [billingSubscription.id, 'id'],
  [billingSubscription.billingAccountId, 'billingAccountId'],
  [billingSubscription.provider, 'provider'],
  [billingSubscription.providerSubscriptionId, 'providerSubscriptionId'],
  [billingEntitlement.billingAccountId, 'billingAccountId'],
  [billingPaymentIssue.billingAccountId, 'billingAccountId'],
  [billingProviderEvent.id, 'id'],
  [billingProviderEvent.provider, 'provider'],
  [billingProviderEvent.providerEventId, 'providerEventId'],
  [billingProviderEvent.scope, 'scope'],
  [billingProviderEvent.processingStatus, 'processingStatus'],
  [billingProviderEvent.processingStartedAt, 'processingStartedAt'],
  [billingOperationAttempt.id, 'id'],
  [billingOperationAttempt.billingAccountId, 'billingAccountId'],
  [billingOperationAttempt.reuseKey, 'reuseKey'],
  [billingOperationAttempt.state, 'state'],
  [billingOperationAttempt.createdAt, 'createdAt'],
  [billingOperationAttempt.handoffExpiresAt, 'handoffExpiresAt'],
  [billingOperationAttempt.idempotencyKey, 'idempotencyKey'],
]);

const columnNameKeys = new Map<string, string>([
  ['id', 'id'],
  ['subject_type', 'subjectType'],
  ['subject_id', 'subjectId'],
  ['provider', 'provider'],
  ['provider_customer_id', 'providerCustomerId'],
  ['billing_account_id', 'billingAccountId'],
  ['provider_subscription_id', 'providerSubscriptionId'],
  ['processing_status', 'processingStatus'],
  ['processing_started_at', 'processingStartedAt'],
  ['reuse_key', 'reuseKey'],
  ['state', 'state'],
  ['created_at', 'createdAt'],
  ['handoff_expires_at', 'handoffExpiresAt'],
  ['idempotency_key', 'idempotencyKey'],
  ['scope', 'scope'],
  ['provider_event_id', 'providerEventId'],
]);

const getColumnKey = (value: unknown) => {
  const knownKey = columnKeys.get(value);
  if (knownKey) {
    return knownKey;
  }

  const columnName = (value as { name?: unknown }).name;
  return typeof columnName === 'string' ? columnNameKeys.get(columnName) : undefined;
};

const isSqlLike = (value: unknown): value is SqlLike =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { queryChunks?: unknown[] }).queryChunks);

const readStringChunk = (value: unknown): string => {
  const chunk = value as { value?: unknown };
  return Array.isArray(chunk.value) ? chunk.value.join('') : '';
};

const compareValues = (actual: unknown, expected: unknown) => {
  if (actual === null || actual === undefined || expected === null || expected === undefined) {
    return Number.NaN;
  }

  const left = actual instanceof Date ? actual.getTime() : actual;
  const right = expected instanceof Date ? expected.getTime() : expected;

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return left.localeCompare(right);
  }

  return Number.NaN;
};

const unwrapQueryValue = (value: unknown) => {
  if (
    value &&
    typeof value === 'object' &&
    'value' in value &&
    !Array.isArray((value as { value?: unknown }).value)
  ) {
    return (value as { value: unknown }).value;
  }

  return value;
};

const evaluateSimpleCondition = (
  condition: SqlLike,
  row: Record<string, unknown>,
): boolean | null => {
  const columnIndex = condition.queryChunks.findIndex((chunk) => Boolean(getColumnKey(chunk)));
  if (columnIndex === -1) {
    return null;
  }

  const columnKey = getColumnKey(condition.queryChunks[columnIndex]);
  if (!columnKey) {
    return null;
  }

  const operator = readStringChunk(condition.queryChunks[columnIndex + 1]);
  const expected = unwrapQueryValue(condition.queryChunks[columnIndex + 2]);
  const actual = row[columnKey];

  if (operator.includes('=')) {
    return actual === expected;
  }
  if (operator.includes('>')) {
    return compareValues(actual, expected) > 0;
  }
  if (operator.includes('<')) {
    return compareValues(actual, expected) < 0;
  }

  return null;
};

const evaluateCondition = (condition: unknown, row: Record<string, unknown>): boolean => {
  if (!isSqlLike(condition)) {
    return true;
  }

  const simple = evaluateSimpleCondition(condition, row);
  if (simple !== null) {
    return simple;
  }

  const childConditions = condition.queryChunks.filter(isSqlLike);
  if (childConditions.length === 0) {
    return true;
  }

  return childConditions.every((childCondition) => evaluateCondition(childCondition, row));
};

const sortRowsByCreatedAtDesc = <TRow>(rows: TRow[]) =>
  [...rows].sort((left, right) => {
    const leftCreatedAt =
      left && typeof left === 'object' ? (left as { createdAt?: unknown }).createdAt : null;
    const leftTime = leftCreatedAt instanceof Date ? leftCreatedAt.getTime() : 0;
    const rightCreatedAt =
      right && typeof right === 'object' ? (right as { createdAt?: unknown }).createdAt : null;
    const rightTime =
      rightCreatedAt instanceof Date ? rightCreatedAt.getTime() : 0;
    return rightTime - leftTime;
  });

const createSelectResult = <TRow>(rows: TRow[]) => ({
  orderBy: () => createSelectResult(sortRowsByCreatedAtDesc(rows)),
  limit: async (count: number) => rows.slice(0, count),
  then: <TResult>(
    resolve: (value: TRow[]) => TResult | PromiseLike<TResult>,
    reject?: (reason: unknown) => TResult | PromiseLike<TResult>,
  ) => Promise.resolve(rows).then(resolve, reject),
});

const createSampleDatabase = ({
  accounts = [],
  subscriptions = [],
  entitlements = [],
  paymentIssues = [],
  invoiceEvents = [],
  providerEvents = [],
  operationAttempts = [],
}: {
  accounts?: (typeof billingAccount.$inferSelect)[];
  subscriptions?: (typeof billingSubscription.$inferSelect)[];
  entitlements?: (typeof billingEntitlement.$inferSelect)[];
  paymentIssues?: (typeof billingPaymentIssue.$inferSelect)[];
  invoiceEvents?: (typeof billingInvoiceEvent.$inferSelect)[];
  providerEvents?: (typeof billingProviderEvent.$inferSelect)[];
  operationAttempts?: (typeof billingOperationAttempt.$inferSelect)[];
} = {}) => {
  const readRows = (table: unknown): Record<string, unknown>[] => {
    if (table === billingAccount) {
      return accounts;
    }
    if (table === billingSubscription) {
      return subscriptions;
    }
    if (table === billingEntitlement) {
      return entitlements;
    }
    if (table === billingPaymentIssue) {
      return paymentIssues;
    }
    if (table === billingInvoiceEvent) {
      return invoiceEvents;
    }
    if (table === billingProviderEvent) {
      return providerEvents;
    }
    if (table === billingOperationAttempt) {
      return operationAttempts;
    }
    return [];
  };

  const applySelection = (
    table: unknown,
    selection: unknown,
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] => {
    if (
      table === billingOperationAttempt &&
      selection &&
      typeof selection === 'object' &&
      'attemptNumber' in selection
    ) {
      const attemptNumbers = rows
        .map((row) => row.attemptNumber)
        .filter((value): value is number => typeof value === 'number');
      return [
        {
          attemptNumber: attemptNumbers.length > 0 ? Math.max(...attemptNumbers) : null,
        },
      ];
    }

    return rows;
  };

  const selectRows = (table: unknown, selection: unknown, condition?: unknown) => {
    const filteredRows = readRows(table).filter((row) => evaluateCondition(condition, row));
    return createSelectResult(applySelection(table, selection, filteredRows));
  };

  const hasConflict = (table: unknown, row: Record<string, unknown>) => {
    if (table === billingAccount) {
      return accounts.some(
        (account) =>
          account.subjectType === row.subjectType && account.subjectId === row.subjectId,
      );
    }
    if (table === billingProviderEvent) {
      return providerEvents.some(
        (event) =>
          event.provider === row.provider &&
          event.providerEventId === row.providerEventId &&
          event.scope === row.scope,
      );
    }
    if (table === billingOperationAttempt) {
      return operationAttempts.some(
        (attempt) =>
          attempt.idempotencyKey === row.idempotencyKey ||
          (attempt.billingAccountId === row.billingAccountId &&
            attempt.reuseKey === row.reuseKey &&
            attempt.attemptNumber === row.attemptNumber),
      );
    }
    if (table === billingPaymentIssue) {
      return paymentIssues.some((issue) => issue.billingAccountId === row.billingAccountId);
    }
    return false;
  };

  const pushRows = (table: unknown, values: unknown): Record<string, unknown>[] => {
    const inputValues = Array.isArray(values) ? values : [values];
    const insertedRows: Record<string, unknown>[] = [];

    for (const value of inputValues) {
      let row: Record<string, unknown> | null = null;
      if (table === billingAccount) {
        row = createBillingAccountRow(value as typeof billingAccount.$inferInsert);
      } else if (table === billingSubscription) {
        row = createBillingSubscriptionRow(value as typeof billingSubscription.$inferInsert);
      } else if (table === billingEntitlement) {
        row = createBillingEntitlementRow(value as typeof billingEntitlement.$inferInsert);
      } else if (table === billingPaymentIssue) {
        row = createBillingPaymentIssueRow(value as typeof billingPaymentIssue.$inferInsert);
      } else if (table === billingInvoiceEvent) {
        row = createBillingInvoiceEventRow(value as typeof billingInvoiceEvent.$inferInsert);
      } else if (table === billingProviderEvent) {
        row = createBillingProviderEventRow(value as typeof billingProviderEvent.$inferInsert);
      } else if (table === billingOperationAttempt) {
        row = createBillingOperationAttemptRow(
          value as typeof billingOperationAttempt.$inferInsert,
        );
      }

      if (!row || hasConflict(table, row)) {
        continue;
      }

      readRows(table).push(row);
      insertedRows.push(row);
    }

    return insertedRows;
  };

  const projectReturnedRows = (rows: Record<string, unknown>[], selection?: unknown) => {
    if (selection && typeof selection === 'object' && 'attemptCount' in selection) {
      return rows.map((row) => ({ attemptCount: row.attemptCount }));
    }
    return rows;
  };

  const database = {
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        const insertedRows = pushRows(table, value);
        return {
          returning: async (selection?: unknown) => projectReturnedRows(insertedRows, selection),
          onConflictDoNothing: () => ({
            returning: async (selection?: unknown) => projectReturnedRows(insertedRows, selection),
          }),
          onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
            if (table !== billingPaymentIssue || insertedRows.length > 0) {
              return;
            }

            const input = value as typeof billingPaymentIssue.$inferInsert;
            const existing = paymentIssues.find(
              (issue) => issue.billingAccountId === input.billingAccountId,
            );
            if (existing) {
              Object.assign(existing, set);
            }
          },
        };
      },
    }),
    select: (selection?: unknown) => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => selectRows(table, selection, condition),
        orderBy: () => selectRows(table, selection).orderBy(),
        limit: (count: number) => selectRows(table, selection).limit(count),
        then: <TResult>(
          resolve: (value: Record<string, unknown>[]) => TResult | PromiseLike<TResult>,
          reject?: (reason: unknown) => TResult | PromiseLike<TResult>,
        ) => selectRows(table, selection).then(resolve, reject),
      }),
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: (condition: unknown) => {
          const updatedRows = readRows(table).filter((row) => evaluateCondition(condition, row));
          for (const row of updatedRows) {
            Object.assign(row, value);
          }
          return {
            returning: async () => updatedRows,
          };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (condition: unknown) => {
        const rows = readRows(table);
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (evaluateCondition(condition, rows[index])) {
            rows.splice(index, 1);
          }
        }
        return Promise.resolve();
      },
    }),
  } as unknown as DrizzleBillingDatabase;

  return {
    database,
    accounts,
    subscriptions,
    entitlements,
    paymentIssues,
    invoiceEvents,
    providerEvents,
    operationAttempts,
  };
};

const createIdSequence = (ids: string[]) => {
  let index = 0;
  return () => ids[index++] ?? `generated-${index}`;
};

const reuseKey = buildSubscriptionCheckoutReuseKey({
  subjectType: 'workspace',
  subjectId: 'workspace-1',
  planCode: 'pro',
  interval: 'month',
});

const createOperationAttempt = ({
  id,
  billingAccountId = 'account-1',
  operationReuseKey = reuseKey,
  attemptNumber = 1,
  state = 'processing',
  createdAt = new Date('2026-01-01T00:00:00.000Z'),
  updatedAt = createdAt,
  handoffUrl = null,
  handoffExpiresAt = null,
}: {
  id: string;
  billingAccountId?: string;
  operationReuseKey?: BillingOperationReuseKey;
  attemptNumber?: number;
  state?: 'processing' | 'succeeded' | 'failed' | 'expired' | 'conflict';
  createdAt?: Date;
  updatedAt?: Date;
  handoffUrl?: string | null;
  handoffExpiresAt?: Date | null;
}) =>
  createBillingOperationAttemptRow({
    id,
    billingAccountId,
    purpose: 'create_subscription_checkout',
    reuseKey: operationReuseKey,
    attemptNumber,
    idempotencyKey: buildBillingOperationIdempotencyKey({
      reuseKey: operationReuseKey,
      attemptNumber,
    }),
    state,
    handoffUrl,
    handoffExpiresAt,
    provider: 'stripe',
    createdAt,
    updatedAt,
  });

const createProviderEvent = ({
  processingStatus,
  receiptStatus,
  attemptCount = 1,
  processingStartedAt = new Date('2026-01-01T00:00:00.000Z'),
  processedAt = null,
  failureReason = null,
}: {
  processingStatus: string;
  receiptStatus: string;
  attemptCount?: number;
  processingStartedAt?: Date | null;
  processedAt?: Date | null;
  failureReason?: string | null;
}) =>
  createBillingProviderEventRow({
    id: 'provider-event-row',
    provider: 'stripe',
    providerEventId: 'evt_1',
    eventType: 'invoice.payment_failed',
    scope: 'billing',
    payloadHash: 'hash-1',
    processingStatus,
    receiptStatus,
    attemptCount,
    processingStartedAt,
    lastAttemptAt: processingStartedAt,
    processingStaleAfterMs: 60_000,
    failureReason,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    processedAt,
  });

describe('createDrizzleBillingStore の課金ストア', () => {
  it('アカウント書き込みと読み取りで任意の課金対象種別を保持する', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const { database } = createSampleDatabase();
    const store = createDrizzleBillingStore({
      database,
      createId: () => 'account-id',
      now: () => createdAt,
    });

    const inserted = await store.ensureAccount({
      subjectType: 'project',
      subjectId: 'project-1',
      provider: 'stripe',
    });
    const found = await store.findAccountBySubject({
      subjectType: 'project',
      subjectId: 'project-1',
    });

    expect(inserted).toEqual(
      expect.objectContaining({
        id: 'account-id',
        subjectType: 'project',
        createdAt,
        updatedAt: createdAt,
      }),
    );
    expect(found?.subjectType).toBe('project');
  });

  it('ワークスペース購読とエンタイトルメントにストアスキーマを再利用する', async () => {
    const createdAt = new Date('2026-01-02T00:00:00.000Z');
    const { database, entitlements, subscriptions } = createSampleDatabase();
    const store = createDrizzleBillingStore({
      database,
      createId: createIdSequence(['account-id', 'subscription-id', 'entitlement-id']),
      now: () => createdAt,
    });

    const account = await store.ensureAccount({
      subjectType: 'workspace',
      subjectId: 'workspace-1',
      provider: 'stripe',
    });
    const subscription = await store.upsertSubscription({
      billingAccountId: account.id,
      provider: 'stripe',
      providerSubscriptionId: 'sub_workspace_1',
      planCode: 'premium',
      priceCode: 'price_workspace_monthly',
      interval: 'month',
      status: 'active',
    });

    await store.replaceEntitlements({
      billingAccountId: account.id,
      entitlements: [
        {
          key: 'premium',
          active: true,
          source: 'paid',
          reason: 'subscription_active',
        },
      ],
    });

    const currentSubscription = await store.findCurrentSubscription({
      billingAccountId: account.id,
    });
    const currentEntitlements = await store.readEntitlements({
      billingAccountId: account.id,
    });

    expect(account.subjectType).toBe('workspace');
    expect(subscription).toEqual(
      expect.objectContaining({
        id: 'subscription-id',
        billingAccountId: account.id,
        createdAt,
        updatedAt: createdAt,
      }),
    );
    expect(currentSubscription?.billingAccountId).toBe(account.id);
    expect(currentEntitlements).toEqual([
      expect.objectContaining({
        id: 'entitlement-id',
        billingAccountId: account.id,
        key: 'premium',
        active: true,
        source: 'paid',
      }),
    ]);
    expect(subscriptions[0]?.billingAccountId).toBe(account.id);
    expect(entitlements[0]?.billingAccountId).toBe(account.id);
  });
});

describe('createDrizzleBillingEventStore のイベントストア', () => {
  it('最初のプロバイダーイベント受領を取得する', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const { database, providerEvents } = createSampleDatabase();
    const store = createDrizzleBillingEventStore({
      database,
      createId: () => 'provider-event-id',
    });

    const result = await store.claimProviderEvent({
      provider: 'stripe',
      providerEventId: 'evt_1',
      eventType: 'invoice.payment_failed',
      payloadHash: 'hash-1',
      now,
      staleProcessingAfterMs: 60_000,
    });

    expect(result).toEqual({ kind: 'claimed', attempt: 1 });
    expect(providerEvents[0]).toEqual(
      expect.objectContaining({
        id: 'provider-event-id',
        providerEventId: 'evt_1',
        processingStatus: 'processing',
        receiptStatus: 'received',
        attemptCount: 1,
        processingStartedAt: now,
        lastAttemptAt: now,
      }),
    );
  });

  it('処理済み重複を再取得せずにマークする', async () => {
    const now = new Date('2026-01-01T00:01:00.000Z');
    const processedAt = new Date('2026-01-01T00:00:30.000Z');
    const providerEvents = [
      createProviderEvent({
        processingStatus: 'processed',
        receiptStatus: 'processed',
        processedAt,
      }),
    ];
    const { database } = createSampleDatabase({ providerEvents });
    const store = createDrizzleBillingEventStore({
      database,
      createId: () => 'unused-provider-event-id',
    });

    const result = await store.claimProviderEvent({
      provider: 'stripe',
      providerEventId: 'evt_1',
      eventType: 'invoice.payment_failed',
      payloadHash: 'hash-2',
      now,
      staleProcessingAfterMs: 60_000,
    });

    expect(result).toEqual({ kind: 'already_processed' });
    expect(providerEvents[0]).toEqual(
      expect.objectContaining({
        duplicateDetected: true,
        duplicateDetectedAt: now,
        receiptStatus: 'duplicate',
        lastAttemptAt: now,
        processedAt,
      }),
    );
  });

  it('失敗したプロバイダーイベントを次の試行番号で再取得する', async () => {
    const now = new Date('2026-01-01T00:01:00.000Z');
    const providerEvents = [
      createProviderEvent({
        processingStatus: 'failed',
        receiptStatus: 'received',
        attemptCount: 1,
        failureReason: 'temporary failure',
      }),
    ];
    const { database } = createSampleDatabase({ providerEvents });
    const store = createDrizzleBillingEventStore({
      database,
      createId: () => 'unused-provider-event-id',
    });

    const result = await store.claimProviderEvent({
      provider: 'stripe',
      providerEventId: 'evt_1',
      eventType: 'invoice.payment_failed',
      payloadHash: 'hash-2',
      now,
      staleProcessingAfterMs: 60_000,
    });

    expect(result).toEqual({ kind: 'already_processing_stale_claimed', attempt: 2 });
    expect(providerEvents[0]).toEqual(
      expect.objectContaining({
        payloadHash: 'hash-2',
        processingStatus: 'processing',
        receiptStatus: 'received',
        attemptCount: 2,
        processingStartedAt: now,
        failureReason: null,
        processedAt: null,
      }),
    );
  });

  it('処理中の古いプロバイダーイベントを重複処理として再取得する', async () => {
    const now = new Date('2026-01-01T00:02:00.000Z');
    const staleStartedAt = new Date('2026-01-01T00:00:00.000Z');
    const providerEvents = [
      createProviderEvent({
        processingStatus: 'processing',
        receiptStatus: 'received',
        attemptCount: 1,
        processingStartedAt: staleStartedAt,
      }),
    ];
    const { database } = createSampleDatabase({ providerEvents });
    const store = createDrizzleBillingEventStore({
      database,
      createId: () => 'unused-provider-event-id',
    });

    const result = await store.claimProviderEvent({
      provider: 'stripe',
      providerEventId: 'evt_1',
      eventType: 'invoice.payment_failed',
      payloadHash: 'hash-2',
      now,
      staleProcessingAfterMs: 60_000,
    });

    expect(result).toEqual({ kind: 'already_processing_stale_claimed', attempt: 2 });
    expect(providerEvents[0]).toEqual(
      expect.objectContaining({
        processingStatus: 'processing',
        receiptStatus: 'duplicate_processing',
        duplicateDetected: true,
        duplicateDetectedAt: now,
        attemptCount: 2,
        processingStartedAt: now,
      }),
    );
  });
});

describe('createDrizzleBillingOperationStore の操作ストア', () => {
  it('決定的な ID で新しい操作試行を取得する', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const { database, operationAttempts } = createSampleDatabase();
    const store = createDrizzleBillingOperationStore({
      database,
      createId: () => 'attempt-id',
    });

    const result = await store.claimAttempt({
      billingAccountId: 'account-1',
      purpose: 'create_subscription_checkout',
      reuseKey,
      provider: 'stripe',
      createdByUserId: 'user-1',
      now,
    });

    expect(result.kind).toBe('claimed');
    expect(result.attempt).toEqual(
      expect.objectContaining({
        id: 'attempt-id',
        attemptNumber: 1,
        idempotencyKey: buildBillingOperationIdempotencyKey({
          reuseKey,
          attemptNumber: 1,
        }),
        createdAt: now,
        updatedAt: now,
      }),
    );
    expect(operationAttempts).toHaveLength(1);
  });

  it('同じ再利用キーの新しい処理中試行を再利用する', async () => {
    const now = new Date('2026-01-01T00:01:00.000Z');
    const operationAttempts = [
      createOperationAttempt({
        id: 'attempt-1',
        createdAt: new Date(now.getTime() - BILLING_OPERATION_PENDING_STALE_MS + 1_000),
      }),
    ];
    const { database } = createSampleDatabase({ operationAttempts });
    const store = createDrizzleBillingOperationStore({
      database,
      createId: () => 'unused-attempt-id',
    });

    const result = await store.claimAttempt({
      billingAccountId: 'account-1',
      purpose: 'create_subscription_checkout',
      reuseKey,
      provider: 'stripe',
      now,
    });

    expect(result.kind).toBe('already_processing_fresh');
    expect(result.attempt.id).toBe('attempt-1');
    expect(operationAttempts).toHaveLength(1);
  });

  it('期限切れでない成功済みハンドオフを再利用する', async () => {
    const now = new Date('2026-01-01T00:01:00.000Z');
    const operationAttempts = [
      createOperationAttempt({
        id: 'attempt-1',
        state: 'succeeded',
        handoffUrl: 'https://checkout.example/session',
        handoffExpiresAt: new Date(now.getTime() + 60_000),
      }),
    ];
    const { database } = createSampleDatabase({ operationAttempts });
    const store = createDrizzleBillingOperationStore({
      database,
      createId: () => 'unused-attempt-id',
    });

    const result = await store.claimAttempt({
      billingAccountId: 'account-1',
      purpose: 'create_subscription_checkout',
      reuseKey,
      provider: 'stripe',
      now,
    });

    expect(result.kind).toBe('reused_succeeded');
    expect(result.attempt.handoffUrl).toBe('https://checkout.example/session');
    expect(operationAttempts).toHaveLength(1);
  });

  it('次の試行を取得する前に古い処理中試行を期限切れにする', async () => {
    const now = new Date('2026-01-01T00:03:00.000Z');
    const operationAttempts = [
      createOperationAttempt({
        id: 'attempt-1',
        createdAt: new Date(now.getTime() - BILLING_OPERATION_PENDING_STALE_MS - 1_000),
      }),
    ];
    const { database } = createSampleDatabase({ operationAttempts });
    const store = createDrizzleBillingOperationStore({
      database,
      createId: () => 'attempt-2',
    });

    const result = await store.claimAttempt({
      billingAccountId: 'account-1',
      purpose: 'create_subscription_checkout',
      reuseKey,
      provider: 'stripe',
      now,
    });

    expect(result.kind).toBe('claimed');
    expect(result.attempt).toEqual(
      expect.objectContaining({
        id: 'attempt-2',
        attemptNumber: 2,
      }),
    );
    expect(operationAttempts[0]).toEqual(
      expect.objectContaining({
        id: 'attempt-1',
        state: 'expired',
        failureReason: 'processing attempt exceeded freshness window',
        updatedAt: now,
      }),
    );
    expect(operationAttempts).toHaveLength(2);
  });

  it('注入された clock で失敗済み・期限切れ試行を更新する', async () => {
    const updatedAt = new Date('2026-01-01T00:04:00.000Z');
    const operationAttempts = [
      createOperationAttempt({ id: 'attempt-1' }),
      createOperationAttempt({ id: 'attempt-2', attemptNumber: 2 }),
    ];
    const { database } = createSampleDatabase({ operationAttempts });
    const store = createDrizzleBillingOperationStore({
      database,
      now: () => updatedAt,
    });

    const failed = await store.markFailed({
      attemptId: 'attempt-1',
      failureReason: 'provider failed',
    });
    const expired = await store.markFailed({
      attemptId: 'attempt-2',
      state: 'expired',
      failureReason: 'handoff expired',
    });

    expect(failed).toEqual(
      expect.objectContaining({
        id: 'attempt-1',
        state: 'failed',
        failureReason: 'provider failed',
        updatedAt,
      }),
    );
    expect(expired).toEqual(
      expect.objectContaining({
        id: 'attempt-2',
        state: 'expired',
        failureReason: 'handoff expired',
        updatedAt,
      }),
    );
  });

  it('最近の試行を新しい順で読み取る', async () => {
    const operationAttempts = [
      createOperationAttempt({
        id: 'old',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      createOperationAttempt({
        id: 'new',
        attemptNumber: 2,
        createdAt: new Date('2026-01-01T00:02:00.000Z'),
      }),
      createOperationAttempt({
        id: 'middle',
        attemptNumber: 3,
        createdAt: new Date('2026-01-01T00:01:00.000Z'),
      }),
      createOperationAttempt({
        id: 'other-account',
        billingAccountId: 'account-2',
        createdAt: new Date('2026-01-01T00:03:00.000Z'),
      }),
    ];
    const { database } = createSampleDatabase({ operationAttempts });
    const store = createDrizzleBillingOperationStore({ database });

    const recent = await store.readRecent({
      billingAccountId: 'account-1',
      limit: 2,
    });

    expect(recent.map((attempt) => attempt.id)).toEqual(['new', 'middle']);
  });
});
