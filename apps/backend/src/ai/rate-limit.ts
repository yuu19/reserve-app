import { and, eq, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';

const USER_HOURLY_LIMIT = 20;
const ORGANIZATION_DAILY_LIMIT = 200;

type WindowKind = 'hour' | 'day';
type ScopeKind = 'user' | 'organization';

export type AiUsageLimitResult =
  | {
      allowed: true;
      userRemainingThisHour: number;
      organizationRemainingToday: number;
    }
  | {
      allowed: false;
      scopeKind: ScopeKind;
      retryAfterSeconds: number;
      userRemainingThisHour: number;
      organizationRemainingToday: number;
    };

const startOfHour = (date: Date): Date => {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  return next;
};

const startOfDay = (date: Date): Date => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const addMs = (date: Date, ms: number): Date => new Date(date.getTime() + ms);

const counterId = ({
  scopeKind,
  scopeId,
  windowKind,
  windowStartAt,
}: {
  scopeKind: ScopeKind;
  scopeId: string;
  windowKind: WindowKind;
  windowStartAt: Date;
}) => `${scopeKind}:${scopeId}:${windowKind}:${windowStartAt.getTime()}`;

const readCounter = async ({
  database,
  scopeKind,
  scopeId,
  windowKind,
  windowStartAt,
}: {
  database: AuthRuntimeDatabase;
  scopeKind: ScopeKind;
  scopeId: string;
  windowKind: WindowKind;
  windowStartAt: Date;
}) => {
  const rows = await database
    .select({ count: dbSchema.aiUsageCounter.count })
    .from(dbSchema.aiUsageCounter)
    .where(
      and(
        eq(dbSchema.aiUsageCounter.scopeKind, scopeKind),
        eq(dbSchema.aiUsageCounter.scopeId, scopeId),
        eq(dbSchema.aiUsageCounter.windowKind, windowKind),
        eq(dbSchema.aiUsageCounter.windowStartAt, windowStartAt),
      ),
    )
    .limit(1);

  return rows[0]?.count ?? 0;
};

const ensureCounterRow = async ({
  database,
  scopeKind,
  scopeId,
  windowKind,
  windowStartAt,
}: {
  database: AuthRuntimeDatabase;
  scopeKind: ScopeKind;
  scopeId: string;
  windowKind: WindowKind;
  windowStartAt: Date;
}) => {
  await database
    .insert(dbSchema.aiUsageCounter)
    .values({
      id: counterId({ scopeKind, scopeId, windowKind, windowStartAt }),
      scopeKind,
      scopeId,
      windowKind,
      windowStartAt,
      count: 0,
    })
    .onConflictDoNothing();
};

type IncrementedCounterRow = {
  scopeKind: ScopeKind;
  count: number;
};

const incrementCountersIfUnderLimit = async ({
  database,
  userId,
  organizationId,
  userWindowStart,
  organizationWindowStart,
  now,
}: {
  database: AuthRuntimeDatabase;
  userId: string;
  organizationId: string;
  userWindowStart: Date;
  organizationWindowStart: Date;
  now: Date;
}): Promise<IncrementedCounterRow[]> => {
  const rows = (await database.all(sql`
    WITH requested(scope_kind, scope_id, window_kind, window_start_at, limit_value) AS MATERIALIZED (
      SELECT 'user', ${userId}, 'hour', ${userWindowStart.getTime()}, ${USER_HOURLY_LIMIT}
      UNION ALL
      SELECT 'organization', ${organizationId}, 'day', ${organizationWindowStart.getTime()}, ${ORGANIZATION_DAILY_LIMIT}
    ),
    allowance(ok_count) AS MATERIALIZED (
      SELECT count(*)
      FROM ai_usage_counter
      JOIN requested
        ON requested.scope_kind = ai_usage_counter.scope_kind
       AND requested.scope_id = ai_usage_counter.scope_id
       AND requested.window_kind = ai_usage_counter.window_kind
       AND requested.window_start_at = ai_usage_counter.window_start_at
      WHERE ai_usage_counter.count < requested.limit_value
    )
    UPDATE ai_usage_counter
    SET count = count + 1,
        updated_at = ${now.getTime()}
    WHERE (SELECT ok_count FROM allowance) = 2
      AND EXISTS (
        SELECT 1
        FROM requested
        WHERE requested.scope_kind = ai_usage_counter.scope_kind
          AND requested.scope_id = ai_usage_counter.scope_id
          AND requested.window_kind = ai_usage_counter.window_kind
          AND requested.window_start_at = ai_usage_counter.window_start_at
    )
    RETURNING scope_kind AS "scopeKind", count;
  `)) as IncrementedCounterRow[];

  return rows;
};

export const checkAndIncrementAiUsage = async ({
  database,
  userId,
  organizationId,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  userId: string;
  organizationId: string;
  now?: Date;
}): Promise<AiUsageLimitResult> => {
  const userWindowStart = startOfHour(now);
  const organizationWindowStart = startOfDay(now);
  await Promise.all([
    ensureCounterRow({
      database,
      scopeKind: 'user',
      scopeId: userId,
      windowKind: 'hour',
      windowStartAt: userWindowStart,
    }),
    ensureCounterRow({
      database,
      scopeKind: 'organization',
      scopeId: organizationId,
      windowKind: 'day',
      windowStartAt: organizationWindowStart,
    }),
  ]);

  const incrementedRows = await incrementCountersIfUnderLimit({
    database,
    userId,
    organizationId,
    userWindowStart,
    organizationWindowStart,
    now,
  });

  if (incrementedRows.length === 2) {
    const nextCounts = new Map(incrementedRows.map((row) => [row.scopeKind, row.count]));
    return {
      allowed: true,
      userRemainingThisHour: Math.max(0, USER_HOURLY_LIMIT - (nextCounts.get('user') ?? 0)),
      organizationRemainingToday: Math.max(
        0,
        ORGANIZATION_DAILY_LIMIT - (nextCounts.get('organization') ?? 0),
      ),
    };
  }

  const [userCount, organizationCount] = await Promise.all([
    readCounter({
      database,
      scopeKind: 'user',
      scopeId: userId,
      windowKind: 'hour',
      windowStartAt: userWindowStart,
    }),
    readCounter({
      database,
      scopeKind: 'organization',
      scopeId: organizationId,
      windowKind: 'day',
      windowStartAt: organizationWindowStart,
    }),
  ]);

  if (userCount >= USER_HOURLY_LIMIT) {
    return {
      allowed: false,
      scopeKind: 'user',
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((addMs(userWindowStart, 60 * 60 * 1000).getTime() - now.getTime()) / 1000),
      ),
      userRemainingThisHour: 0,
      organizationRemainingToday: Math.max(0, ORGANIZATION_DAILY_LIMIT - organizationCount),
    };
  }

  if (organizationCount >= ORGANIZATION_DAILY_LIMIT) {
    return {
      allowed: false,
      scopeKind: 'organization',
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (addMs(organizationWindowStart, 24 * 60 * 60 * 1000).getTime() - now.getTime()) / 1000,
        ),
      ),
      userRemainingThisHour: Math.max(0, USER_HOURLY_LIMIT - userCount),
      organizationRemainingToday: 0,
    };
  }

  return {
    allowed: false,
    scopeKind: 'user',
    retryAfterSeconds: 1,
    userRemainingThisHour: Math.max(0, USER_HOURLY_LIMIT - userCount),
    organizationRemainingToday: Math.max(0, ORGANIZATION_DAILY_LIMIT - organizationCount),
  };
};

export const compactExpiredAiUsageCounters = async ({
  database,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  now?: Date;
}) => {
  const hourCutoff = new Date(startOfHour(now).getTime() - 24 * 60 * 60 * 1000);
  const dayCutoff = new Date(startOfDay(now).getTime() - 7 * 24 * 60 * 60 * 1000);

  await database
    .delete(dbSchema.aiUsageCounter)
    .where(
      sql`(${dbSchema.aiUsageCounter.windowKind} = 'hour' and ${dbSchema.aiUsageCounter.windowStartAt} < ${hourCutoff}) or (${dbSchema.aiUsageCounter.windowKind} = 'day' and ${dbSchema.aiUsageCounter.windowStartAt} < ${dayCutoff})`,
    );
};
