import { describe, expect, it } from 'vitest';
import type { DrizzleBillingDatabase } from './database.js';
import { billingAccount, billingEntitlement, billingSubscription } from './schema.js';
import { createDrizzleBillingStore } from './store.js';

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

const createSelectResult = <TRow>(rows: TRow[]) => ({
  orderBy: () => createSelectResult(rows),
  limit: async (count: number) => rows.slice(0, count),
  then: <TResult>(
    resolve: (value: TRow[]) => TResult | PromiseLike<TResult>,
    reject?: (reason: unknown) => TResult | PromiseLike<TResult>,
  ) => Promise.resolve(rows).then(resolve, reject),
});

const createSampleDatabase = () => {
  const accounts: (typeof billingAccount.$inferSelect)[] = [];
  const subscriptions: (typeof billingSubscription.$inferSelect)[] = [];
  const entitlements: (typeof billingEntitlement.$inferSelect)[] = [];
  const readRows = (table: unknown): unknown[] => {
    if (table === billingAccount) {
      return accounts;
    }
    if (table === billingSubscription) {
      return subscriptions;
    }
    if (table === billingEntitlement) {
      return entitlements;
    }
    return [];
  };
  const database = {
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        if (table === billingSubscription) {
          return {
            returning: async () => {
              const row = createBillingSubscriptionRow(
                value as typeof billingSubscription.$inferInsert,
              );
              subscriptions.push(row);
              return [row];
            },
          };
        }
        if (table === billingEntitlement && Array.isArray(value)) {
          const rows = value.map((item) =>
            createBillingEntitlementRow(item as typeof billingEntitlement.$inferInsert),
          );
          entitlements.push(...rows);
          return Promise.resolve(rows);
        }
        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              const row = createBillingAccountRow(value as typeof billingAccount.$inferInsert);
              accounts.push(row);
              return [row];
            },
          }),
        };
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => createSelectResult(readRows(table)),
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        if (table === billingEntitlement) {
          entitlements.length = 0;
        }
        return Promise.resolve();
      },
    }),
  } as unknown as DrizzleBillingDatabase;

  return { database, accounts, subscriptions, entitlements };
};

describe('createDrizzleBillingStore', () => {
  it('preserves arbitrary billing subject types when writing and reading accounts', async () => {
    const { database } = createSampleDatabase();
    const store = createDrizzleBillingStore({ database });

    const inserted = await store.ensureAccount({
      subjectType: 'project',
      subjectId: 'project-1',
      provider: 'stripe',
    });
    const found = await store.findAccountBySubject({
      subjectType: 'project',
      subjectId: 'project-1',
    });

    expect(inserted.subjectType).toBe('project');
    expect(found?.subjectType).toBe('project');
  });

  it('reuses the store schema for workspace subscriptions and entitlements', async () => {
    const { database, entitlements, subscriptions } = createSampleDatabase();
    const store = createDrizzleBillingStore({ database });

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
    expect(subscription.billingAccountId).toBe(account.id);
    expect(currentSubscription?.billingAccountId).toBe(account.id);
    expect(currentEntitlements).toEqual([
      expect.objectContaining({
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
