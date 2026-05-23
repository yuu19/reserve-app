import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import type { AiSourceReference } from '../../features/ai/source-visibility.js';
import * as dbSchema from '../db/schema.js';

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

/**
 * 既存の会話が完全に同じユーザー・組織・教室スコープに属するときだけ再利用する。
 *
 * null は指定された会話 ID が呼び出し側の現在の認可境界外であることを示し、
 * ルート側では forbidden として扱う。
 */
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

/** 検索・モデル・保持期限メタデータとあわせてユーザー/アシスタントメッセージを保存する。 */
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

/** 呼び出し側スコープ内のアシスタントメッセージにだけフィードバックを付与できることを確認する。 */
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

/** 集計用のフィードバック期間を維持しながら、ユーザー/メッセージごとに feedback を upsert する。 */
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

/** 集計用の feedback signal を残しつつ、期限切れの会話内容を匿名化する。 */
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
  // 保持期間と情報開示リスクを下げるため、メッセージログには id、score、visibility だけを残し、
  // 検索済みテキストの全文は保存しない。
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

export type EnsureAiConversationInput = Omit<
  Parameters<typeof ensureAiConversation>[0],
  'database'
>;
export type InsertAiMessageInput = Omit<Parameters<typeof insertAiMessage>[0], 'database'>;
export type CanUserAccessAssistantMessageInput = Omit<
  Parameters<typeof canUserAccessAssistantMessage>[0],
  'database'
>;
export type SubmitAiFeedbackInput = Omit<Parameters<typeof submitAiFeedback>[0], 'database'>;
export type CleanupExpiredAiConversationContentInput = Omit<
  Parameters<typeof cleanupExpiredAiConversationContent>[0],
  'database'
>;
export type CountAiMessagesForConversationInput = Omit<
  Parameters<typeof countAiMessagesForConversation>[0],
  'database'
>;

export type DrizzleAiConversationStore = {
  ensureConversation(
    input: EnsureAiConversationInput,
  ): Promise<{ conversationId: string; created: boolean } | null>;
  insertMessage(input: InsertAiMessageInput): Promise<StoredAssistantMessage>;
  canUserAccessAssistantMessage(
    input: CanUserAccessAssistantMessageInput,
  ): ReturnType<typeof canUserAccessAssistantMessage>;
  submitFeedback(input: SubmitAiFeedbackInput): ReturnType<typeof submitAiFeedback>;
  cleanupExpiredConversationContent(
    input?: CleanupExpiredAiConversationContentInput,
  ): Promise<void>;
  countMessagesForConversation(input: CountAiMessagesForConversationInput): Promise<number>;
};

export const createDrizzleAiConversationStore = ({
  database,
}: {
  database: AuthRuntimeDatabase;
}): DrizzleAiConversationStore => ({
  ensureConversation: (input) =>
    ensureAiConversation({
      database,
      ...input,
    }),
  insertMessage: (input) =>
    insertAiMessage({
      database,
      ...input,
    }),
  canUserAccessAssistantMessage: (input) =>
    canUserAccessAssistantMessage({
      database,
      ...input,
    }),
  submitFeedback: (input) =>
    submitAiFeedback({
      database,
      ...input,
    }),
  cleanupExpiredConversationContent: (input = {}) =>
    cleanupExpiredAiConversationContent({
      database,
      ...input,
    }),
  countMessagesForConversation: (input) =>
    countAiMessagesForConversation({
      database,
      ...input,
    }),
});
