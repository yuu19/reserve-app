import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import type { AiSourceReference } from './source-visibility.js';

const CONVERSATION_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const FEEDBACK_AGGREGATE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const ANONYMIZED_CONTENT = '[deleted by AI retention policy]';

export type ConversationScope = {
  userId: string;
  organizationId: string | null;
  classroomId: string | null;
};

export type StoredAssistantMessage = {
  id: string;
  conversationId: string;
};

const retentionExpiresAt = (now: Date): Date => new Date(now.getTime() + CONVERSATION_RETENTION_MS);

const feedbackRetentionExpiresAt = (now: Date): Date =>
  new Date(now.getTime() + FEEDBACK_AGGREGATE_RETENTION_MS);

export const ensureAiConversation = async ({
  database,
  conversationId,
  scope,
  title,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  conversationId?: string | null;
  scope: ConversationScope;
  title?: string | null;
  now?: Date;
}): Promise<{ conversationId: string; created: boolean } | null> => {
  if (conversationId) {
    const rows = await database
      .select()
      .from(dbSchema.aiConversation)
      .where(
        and(
          eq(dbSchema.aiConversation.id, conversationId),
          eq(dbSchema.aiConversation.userId, scope.userId),
          scope.organizationId
            ? eq(dbSchema.aiConversation.organizationId, scope.organizationId)
            : isNull(dbSchema.aiConversation.organizationId),
          scope.classroomId
            ? eq(dbSchema.aiConversation.classroomId, scope.classroomId)
            : isNull(dbSchema.aiConversation.classroomId),
          isNull(dbSchema.aiConversation.anonymizedAt),
        ),
      )
      .limit(1);

    if (!rows[0]) {
      return null;
    }

    await database
      .update(dbSchema.aiConversation)
      .set({
        updatedAt: now,
      })
      .where(eq(dbSchema.aiConversation.id, conversationId));

    return { conversationId, created: false };
  }

  const id = crypto.randomUUID();
  await database.insert(dbSchema.aiConversation).values({
    id,
    userId: scope.userId,
    organizationId: scope.organizationId,
    classroomId: scope.classroomId,
    title: title?.slice(0, 120) ?? null,
    createdAt: now,
    updatedAt: now,
    retentionExpiresAt: retentionExpiresAt(now),
  });

  return { conversationId: id, created: true };
};

export const insertAiMessage = async ({
  database,
  conversationId,
  role,
  content,
  sources,
  retrievedContext,
  confidence,
  needsHumanSupport = false,
  aiGatewayLogId,
  aiModel,
  aiLatencyMs,
  aiGenerationStatus,
  aiErrorSummary,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: AiSourceReference[] | null;
  retrievedContext?: unknown;
  confidence?: number | null;
  needsHumanSupport?: boolean;
  aiGatewayLogId?: string | null;
  aiModel?: string | null;
  aiLatencyMs?: number | null;
  aiGenerationStatus?: string | null;
  aiErrorSummary?: string | null;
  now?: Date;
}): Promise<StoredAssistantMessage> => {
  const id = crypto.randomUUID();
  await database.insert(dbSchema.aiMessage).values({
    id,
    conversationId,
    role,
    content,
    sourcesJson: sources ? JSON.stringify(sources) : null,
    retrievedContextJson: retrievedContext ? JSON.stringify(retrievedContext) : null,
    confidence: confidence ?? null,
    needsHumanSupport,
    aiGatewayLogId: aiGatewayLogId ?? null,
    aiModel: aiModel ?? null,
    aiLatencyMs: aiLatencyMs ?? null,
    aiGenerationStatus: aiGenerationStatus ?? null,
    aiErrorSummary: aiErrorSummary ?? null,
    createdAt: now,
    retentionExpiresAt: retentionExpiresAt(now),
  });

  await database
    .update(dbSchema.aiConversation)
    .set({ updatedAt: now })
    .where(eq(dbSchema.aiConversation.id, conversationId));

  return { id, conversationId };
};

export const canUserAccessAssistantMessage = async ({
  database,
  messageId,
  scope,
}: {
  database: AuthRuntimeDatabase;
  messageId: string;
  scope: ConversationScope;
}) => {
  const rows = await database
    .select({
      id: dbSchema.aiMessage.id,
      conversationId: dbSchema.aiMessage.conversationId,
    })
    .from(dbSchema.aiMessage)
    .innerJoin(
      dbSchema.aiConversation,
      eq(dbSchema.aiMessage.conversationId, dbSchema.aiConversation.id),
    )
    .where(
      and(
        eq(dbSchema.aiMessage.id, messageId),
        eq(dbSchema.aiMessage.role, 'assistant'),
        eq(dbSchema.aiConversation.userId, scope.userId),
        scope.organizationId
          ? eq(dbSchema.aiConversation.organizationId, scope.organizationId)
          : isNull(dbSchema.aiConversation.organizationId),
        scope.classroomId
          ? eq(dbSchema.aiConversation.classroomId, scope.classroomId)
          : isNull(dbSchema.aiConversation.classroomId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
};

export const submitAiFeedback = async ({
  database,
  messageId,
  userId,
  rating,
  comment,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  messageId: string;
  userId: string;
  rating: 'helpful' | 'unhelpful';
  comment?: string | null;
  now?: Date;
}) => {
  const id = crypto.randomUUID();
  const rows = await database
    .insert(dbSchema.aiFeedback)
    .values({
      id,
      messageId,
      userId,
      rating,
      comment: comment?.trim() ? comment.trim().slice(0, 1000) : null,
      resolved: false,
      createdAt: now,
      aggregateRetentionExpiresAt: feedbackRetentionExpiresAt(now),
    })
    .onConflictDoUpdate({
      target: [dbSchema.aiFeedback.messageId, dbSchema.aiFeedback.userId],
      set: {
        rating,
        comment: comment?.trim() ? comment.trim().slice(0, 1000) : null,
        resolved: false,
      },
    })
    .returning({
      id: dbSchema.aiFeedback.id,
      messageId: dbSchema.aiFeedback.messageId,
      rating: dbSchema.aiFeedback.rating,
    });

  return rows[0] ?? { id, messageId, rating };
};

export const listAiKnowledgeStatuses = async ({ database }: { database: AuthRuntimeDatabase }) => {
  const rows = await database
    .select({
      documentId: dbSchema.aiKnowledgeDocument.id,
      sourceKind: dbSchema.aiKnowledgeDocument.sourceKind,
      title: dbSchema.aiKnowledgeDocument.title,
      sourcePath: dbSchema.aiKnowledgeDocument.sourcePath,
      locale: dbSchema.aiKnowledgeDocument.locale,
      visibility: dbSchema.aiKnowledgeDocument.visibility,
      internalOnly: dbSchema.aiKnowledgeDocument.internalOnly,
      indexStatus: dbSchema.aiKnowledgeDocument.indexStatus,
      indexedAt: dbSchema.aiKnowledgeDocument.indexedAt,
      lastError: dbSchema.aiKnowledgeDocument.lastError,
    })
    .from(dbSchema.aiKnowledgeDocument)
    .orderBy(desc(dbSchema.aiKnowledgeDocument.updatedAt))
    .limit(200);

  type KnowledgeStatusRow = {
    documentId: string;
    sourceKind: string;
    title: string;
    sourcePath: string;
    locale: string;
    visibility: string;
    internalOnly: boolean;
    indexStatus: string;
    indexedAt: Date | null;
    lastError: string | null;
  };

  return (rows as KnowledgeStatusRow[]).map((row) => ({
    ...row,
    indexedAt: row.indexedAt ? row.indexedAt.toISOString() : null,
  }));
};

export const listAiFeedbackThemes = async ({ database }: { database: AuthRuntimeDatabase }) => {
  const rows = await database
    .select({
      rating: dbSchema.aiFeedback.rating,
      comment: dbSchema.aiFeedback.comment,
      createdAt: dbSchema.aiFeedback.createdAt,
    })
    .from(dbSchema.aiFeedback)
    .where(eq(dbSchema.aiFeedback.rating, 'unhelpful'))
    .orderBy(desc(dbSchema.aiFeedback.createdAt))
    .limit(200);

  const themes = new Map<string, { theme: string; count: number; latestAt: Date | null }>();
  for (const row of rows) {
    const theme = row.comment?.trim().slice(0, 80) || 'commentなしの低評価';
    const current = themes.get(theme);
    if (!current) {
      themes.set(theme, { theme, count: 1, latestAt: row.createdAt ?? null });
      continue;
    }
    current.count += 1;
    if (row.createdAt && (!current.latestAt || row.createdAt > current.latestAt)) {
      current.latestAt = row.createdAt;
    }
  }

  return Array.from(themes.values()).map((theme) => ({
    theme: theme.theme,
    count: theme.count,
    latestAt: theme.latestAt ? theme.latestAt.toISOString() : null,
  }));
};

export const cleanupExpiredAiConversationContent = async ({
  database,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  now?: Date;
}) => {
  await database
    .update(dbSchema.aiMessage)
    .set({
      content: ANONYMIZED_CONTENT,
      anonymizedAt: now,
    })
    .where(
      and(lt(dbSchema.aiMessage.retentionExpiresAt, now), isNull(dbSchema.aiMessage.anonymizedAt)),
    );

  await database
    .update(dbSchema.aiConversation)
    .set({
      title: null,
      anonymizedAt: now,
    })
    .where(
      and(
        lt(dbSchema.aiConversation.retentionExpiresAt, now),
        isNull(dbSchema.aiConversation.anonymizedAt),
      ),
    );

  await database
    .delete(dbSchema.aiFeedback)
    .where(lt(dbSchema.aiFeedback.aggregateRetentionExpiresAt, now));
};

export const readRetrievedContextSummary = ({
  chunks,
  businessFactKeys,
  retrievalErrorSummary,
}: {
  chunks: Array<{ id: string; score?: number; visibility?: string | null }>;
  businessFactKeys: string[];
  retrievalErrorSummary?: string | null;
}) => ({
  chunks: chunks.map((chunk) => ({
    id: chunk.id,
    score: chunk.score ?? null,
    visibility: chunk.visibility ?? null,
  })),
  businessFactKeys,
  retrievalErrorSummary: retrievalErrorSummary ?? null,
});

export const countAiMessagesForConversation = async ({
  database,
  conversationId,
}: {
  database: AuthRuntimeDatabase;
  conversationId: string;
}) => {
  const rows = await database
    .select({ count: sql<number>`count(*)` })
    .from(dbSchema.aiMessage)
    .where(eq(dbSchema.aiMessage.conversationId, conversationId));

  return Number(rows[0]?.count ?? 0);
};
