import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

/** D1/SQLite 系 Drizzle adapter から課金 store が利用する database 型。 */
export type DrizzleBillingDatabase = BaseSQLiteDatabase<'async', unknown>;
