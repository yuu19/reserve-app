import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

export type DrizzleBillingDatabase = BaseSQLiteDatabase<'async', unknown>;
