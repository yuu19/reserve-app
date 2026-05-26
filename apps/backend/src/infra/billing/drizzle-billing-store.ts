import {
  createDrizzleBillingStore as createSharedDrizzleBillingStore,
  type DrizzleBillingDatabase,
} from '@repo/saas-billing-drizzle';
import type { BillingStore } from '@repo/saas-billing-core';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';

export const createDrizzleBillingStore = ({
  database,
}: {
  database: AuthRuntimeDatabase;
}): BillingStore =>
  createSharedDrizzleBillingStore({ database: database as DrizzleBillingDatabase });
