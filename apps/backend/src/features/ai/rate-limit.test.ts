import { describe, expect, it } from 'vitest';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { checkAndIncrementAiUsage } from './rate-limit.js';

const createDatabase = ({
  incrementedRows,
  readCounts = [],
}: {
  incrementedRows: unknown[];
  readCounts?: number[];
}) => {
  const inserts: unknown[] = [];
  const atomicUpdates: unknown[] = [];
  const database = {
    all: async (query: unknown) => {
      atomicUpdates.push(query);
      return incrementedRows;
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const count = readCounts.shift() ?? 0;
            return [{ count }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (value: unknown) => {
        inserts.push(value);
        return {
          onConflictDoNothing: async () => undefined,
        };
      },
    }),
  };

  return {
    database: database as unknown as AuthRuntimeDatabase,
    inserts,
    atomicUpdates,
  };
};

describe('AI 使用量レート制限', () => {
  it('ユーザー時間単位と組織日単位の上限に余裕がある場合は両方のカウンターを増やす', async () => {
    const { database, inserts, atomicUpdates } = createDatabase({
      incrementedRows: [
        { scopeKind: 'user', count: 4 },
        { scopeKind: 'organization', count: 41 },
      ],
    });

    await expect(
      checkAndIncrementAiUsage({
        database,
        userId: 'user-a',
        organizationId: 'org-a',
        now: new Date('2026-05-13T12:34:56.000Z'),
      }),
    ).resolves.toEqual({
      allowed: true,
      userRemainingThisHour: 16,
      organizationRemainingToday: 159,
    });
    expect(inserts).toHaveLength(2);
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeKind: 'user',
          scopeId: 'user-a',
          windowKind: 'hour',
          count: 0,
        }),
        expect.objectContaining({
          scopeKind: 'organization',
          scopeId: 'org-a',
          windowKind: 'day',
          count: 0,
        }),
      ]),
    );
    expect(atomicUpdates).toHaveLength(1);
  });

  it('ユーザーごとの時間単位上限を使い切った場合はリクエストを拒否する', async () => {
    const { database, inserts, atomicUpdates } = createDatabase({
      incrementedRows: [],
      readCounts: [20, 40],
    });

    await expect(
      checkAndIncrementAiUsage({
        database,
        userId: 'user-a',
        organizationId: 'org-a',
        now: new Date('2026-05-13T12:50:00.000Z'),
      }),
    ).resolves.toMatchObject({
      allowed: false,
      scopeKind: 'user',
      retryAfterSeconds: 600,
      userRemainingThisHour: 0,
      organizationRemainingToday: 160,
    });
    expect(inserts).toHaveLength(2);
    expect(atomicUpdates).toHaveLength(1);
  });

  it('組織ごとの日単位上限を使い切った場合はリクエストを拒否する', async () => {
    const { database, inserts, atomicUpdates } = createDatabase({
      incrementedRows: [],
      readCounts: [4, 200],
    });

    const result = await checkAndIncrementAiUsage({
      database,
      userId: 'user-a',
      organizationId: 'org-a',
      now: new Date('2026-05-13T23:30:00.000Z'),
    });

    expect(result).toMatchObject({
      allowed: false,
      scopeKind: 'organization',
      userRemainingThisHour: 16,
      organizationRemainingToday: 0,
    });
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(inserts).toHaveLength(2);
    expect(atomicUpdates).toHaveLength(1);
  });
});
