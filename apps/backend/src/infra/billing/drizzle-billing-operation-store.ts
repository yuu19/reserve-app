import {
  createDrizzleBillingOperationStore as createSharedDrizzleBillingOperationStore,
  type DrizzleBillingDatabase,
} from '@repo/saas-billing-drizzle';
import type { BillingOperationStore } from '@repo/saas-billing-core';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';

export const createDrizzleBillingOperationStore = ({
  database,
}: {
  database: AuthRuntimeDatabase;
}): BillingOperationStore =>
  createSharedDrizzleBillingOperationStore({ database: database as DrizzleBillingDatabase });
