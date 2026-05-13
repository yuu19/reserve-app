import { describe, expect, it } from 'vitest';
import type { AuthRuntimeDatabase } from '../auth-runtime.js';
import {
  cleanupExpiredAiConversationContent,
  ensureAiConversation,
  insertAiMessage,
} from './conversation-store.js';

const createDatabase = (selectedRows: unknown[][] = []) => {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const deletes: unknown[] = [];
  const database = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectedRows.shift() ?? [],
        }),
      }),
    }),
    insert: () => ({
      values: async (value: unknown) => {
        inserts.push(value);
      },
    }),
    update: () => ({
      set: (value: unknown) => {
        updates.push(value);
        return {
          where: async () => undefined,
        };
      },
    }),
    delete: () => ({
      where: async (value: unknown) => {
        deletes.push(value);
      },
    }),
  };

  return {
    database: database as unknown as AuthRuntimeDatabase,
    inserts,
    updates,
    deletes,
  };
};

describe('AI conversation store', () => {
  it('creates conversations with scoped retention metadata', async () => {
    const now = new Date('2026-05-13T00:00:00.000Z');
    const { database, inserts } = createDatabase();

    const result = await ensureAiConversation({
      database,
      now,
      title: '予約枠を作るには？',
      scope: {
        userId: 'user-a',
        organizationId: 'org-a',
        classroomId: 'class-a',
      },
    });

    expect(result).toMatchObject({ created: true });
    expect(inserts[0]).toMatchObject({
      userId: 'user-a',
      organizationId: 'org-a',
      classroomId: 'class-a',
      title: '予約枠を作るには？',
      createdAt: now,
      updatedAt: now,
    });
    expect((inserts[0] as { retentionExpiresAt: Date }).retentionExpiresAt.toISOString()).toBe(
      '2026-11-09T00:00:00.000Z',
    );
  });

  it('rejects conversation continuation when the scoped row is not found', async () => {
    const { database, updates } = createDatabase([[]]);

    await expect(
      ensureAiConversation({
        database,
        conversationId: 'conversation-a',
        scope: {
          userId: 'user-a',
          organizationId: 'org-a',
          classroomId: 'class-a',
        },
      }),
    ).resolves.toBeNull();
    expect(updates).toHaveLength(0);
  });

  it('persists assistant message metadata and retention timestamp', async () => {
    const now = new Date('2026-05-13T00:00:00.000Z');
    const { database, inserts, updates } = createDatabase();

    const result = await insertAiMessage({
      database,
      now,
      conversationId: 'conversation-a',
      role: 'assistant',
      content: '回答',
      sources: [{ sourceKind: 'docs', title: '予約運用', chunkId: 'chunk-a' }],
      retrievedContext: { chunks: [{ id: 'chunk-a' }], businessFactKeys: ['service_count'] },
      confidence: 82,
      needsHumanSupport: false,
    });

    expect(result).toMatchObject({ conversationId: 'conversation-a' });
    expect(inserts[0]).toMatchObject({
      conversationId: 'conversation-a',
      role: 'assistant',
      content: '回答',
      confidence: 82,
      needsHumanSupport: false,
      createdAt: now,
    });
    expect(inserts[0]).toMatchObject({
      sourcesJson: JSON.stringify([{ sourceKind: 'docs', title: '予約運用', chunkId: 'chunk-a' }]),
      retrievedContextJson: JSON.stringify({
        chunks: [{ id: 'chunk-a' }],
        businessFactKeys: ['service_count'],
      }),
    });
    expect((inserts[0] as { retentionExpiresAt: Date }).retentionExpiresAt.toISOString()).toBe(
      '2026-11-09T00:00:00.000Z',
    );
    expect(updates[0]).toEqual({ updatedAt: now });
  });

  it('anonymizes expired conversation content and deletes expired feedback aggregates', async () => {
    const now = new Date('2026-05-13T00:00:00.000Z');
    const { database, updates, deletes } = createDatabase();

    await cleanupExpiredAiConversationContent({ database, now });

    expect(updates).toEqual([
      {
        content: '[deleted by AI retention policy]',
        anonymizedAt: now,
      },
      {
        title: null,
        anonymizedAt: now,
      },
    ]);
    expect(deletes).toHaveLength(1);
  });
});
