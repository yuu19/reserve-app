import { desc, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import * as dbSchema from '../db/schema.js';

export type AiKnowledgeStatus = {
  documentId: string;
  sourceKind: string;
  title: string;
  sourcePath: string;
  locale: string;
  visibility: string;
  internalOnly: boolean;
  indexStatus: string;
  indexedAt: string | null;
  lastError: string | null;
};

export type AiFeedbackTheme = {
  theme: string;
  count: number;
  latestAt: string | null;
};

/** chunk 本文を露出せず、内部ナレッジの鮮度 view を返す。 */
export const listAiKnowledgeStatuses = async ({
  database,
}: {
  database: AuthRuntimeDatabase;
}): Promise<AiKnowledgeStatus[]> => {
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

  type KnowledgeStatusRow = Omit<AiKnowledgeStatus, 'indexedAt'> & {
    indexedAt: Date | null;
  };

  return (rows as KnowledgeStatusRow[]).map((row) => ({
    ...row,
    indexedAt: row.indexedAt ? row.indexedAt.toISOString() : null,
  }));
};

/** 運用者レビュー向けに、直近の低評価 feedback コメントを軽量テーマに集約する。 */
export const listAiFeedbackThemes = async ({
  database,
}: {
  database: AuthRuntimeDatabase;
}): Promise<AiFeedbackTheme[]> => {
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

export type DrizzleAiObservabilityStore = {
  listKnowledgeStatuses(): Promise<AiKnowledgeStatus[]>;
  listFeedbackThemes(): Promise<AiFeedbackTheme[]>;
};

export const createDrizzleAiObservabilityStore = ({
  database,
}: {
  database: AuthRuntimeDatabase;
}): DrizzleAiObservabilityStore => ({
  listKnowledgeStatuses: () => listAiKnowledgeStatuses({ database }),
  listFeedbackThemes: () => listAiFeedbackThemes({ database }),
});
