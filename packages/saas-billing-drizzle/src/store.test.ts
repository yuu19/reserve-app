import { describe, expect, it } from 'vitest';
import type { DrizzleBillingDatabase } from './database.js';
import { billingAccount } from './schema.js';
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

const createAccountOnlyDatabase = () => {
  const accounts: (typeof billingAccount.$inferSelect)[] = [];
  const database = {
    insert: () => ({
      values: (value: typeof billingAccount.$inferInsert) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            const row = createBillingAccountRow(value);
            accounts.push(row);
            return [row];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => accounts.slice(0, 1),
        }),
      }),
    }),
  } as unknown as DrizzleBillingDatabase;

  return { database, accounts };
};

describe('createDrizzleBillingStore', () => {
  it('preserves arbitrary billing subject types when writing and reading accounts', async () => {
    const { database } = createAccountOnlyDatabase();
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
});
