import {
  createDrizzleBillingEventStore as createSharedDrizzleBillingEventStore,
  type DrizzleBillingDatabase,
} from '@repo/saas-billing-drizzle';
import type { BillingEventStore } from '@repo/saas-billing-core';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';

export const createDrizzleBillingEventStore = ({
  database,
}: {
  database: AuthRuntimeDatabase;
}): BillingEventStore =>
  createSharedDrizzleBillingEventStore({ database: database as DrizzleBillingDatabase });
