import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema.js';

export type BillingApiDatabase = DrizzleD1Database<typeof schema>;

export const createBillingApiDatabase = (database: D1Database): BillingApiDatabase =>
  drizzle(database, { schema });
