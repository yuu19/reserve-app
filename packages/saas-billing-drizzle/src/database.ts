import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

/** D1/SQLite 系 Drizzle adapter で課金の永続化処理が利用する database 型。 */
export type DrizzleBillingDatabase = BaseSQLiteDatabase<'async', unknown>;
