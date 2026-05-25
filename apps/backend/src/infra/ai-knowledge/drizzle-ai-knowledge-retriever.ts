import type {
  EmbeddingProvider,
  KnowledgeRetriever,
  RetrievedKnowledgeChunk,
  SourceVisibilityPolicy,
} from '@repo/saas-chatbot-core';
import { eq, inArray } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import type { OrganizationClassroomAccess } from '../../domain/booking/authorization.js';
import {
  AI_SOURCE_KINDS,
  type AiSourceKind,
  type AiSourceVisibility,
} from '../../features/ai/source-visibility.js';
import {
  createWorkersAiEmbeddingProvider,
  type AiEmbeddingEnv,
} from '../ai/cloudflare-ai-embedding-provider.js';
import * as dbSchema from '../db/schema.js';

export type AiRetrieverEnv = AiEmbeddingEnv & {
  AI_KNOWLEDGE_INDEX?: {
    query: (
      vector: number[],
      options?: {
        topK?: number;
        returnMetadata?: boolean | 'all';
        filter?: Record<string, unknown>;
      },
    ) => Promise<{
      matches?: Array<{ id: string; score?: number; metadata?: Record<string, unknown> }>;
    }>;
  };
};

export type { RetrievedKnowledgeChunk } from '@repo/saas-chatbot-core';

const isAiSourceKind = (value: string): value is AiSourceKind =>
  AI_SOURCE_KINDS.includes(value as AiSourceKind);

const normalizeSourceKind = (value: string): AiSourceKind =>
  isAiSourceKind(value) ? value : 'docs';

/**
 * Vectorize match を取得し、各チャンクを D1 の可視性メタデータで再検証する。
 *
 * Vector filter は検索範囲を狭めるだけで、index status、情報源スコープ、locale、
 * 重複 content 抑制の正本は D1 とする。
 */
export const retrieveKnowledge = async ({
  env,
  database,
  embeddingProvider = createWorkersAiEmbeddingProvider({ env }),
  sourceVisibilityPolicy,
  message,
  context,
  allowedVisibilities,
  internalOperator,
  locale = 'ja',
}: {
  env: AiRetrieverEnv;
  database: AuthRuntimeDatabase;
  embeddingProvider?: EmbeddingProvider;
  sourceVisibilityPolicy: SourceVisibilityPolicy<OrganizationClassroomAccess>;
  message: string;
  context: OrganizationClassroomAccess;
  allowedVisibilities: AiSourceVisibility[];
  internalOperator: boolean;
  locale?: string;
}): Promise<RetrievedKnowledgeChunk[]> => {
  if (!embeddingProvider.isConfigured || !env.AI_KNOWLEDGE_INDEX) {
    return [];
  }

  const embedding = await embeddingProvider.generateEmbedding({
    text: message,
    cache: false,
  });

  const queryResult = await env.AI_KNOWLEDGE_INDEX.query(embedding.vector, {
    topK: 12,
    returnMetadata: true,
    filter: {
      locale: { $eq: locale },
      visibility: { $in: allowedVisibilities },
    },
  });

  const matches = queryResult.matches ?? [];
  if (matches.length === 0) {
    return [];
  }

  // Vectorize の match order だけを信用せず、document row で stale/deleted chunk を落としてから
  // 残った候補を score 順に並べる。
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const chunkIds = matches.map((match) => match.id);
  const rows = await database
    .select({
      id: dbSchema.aiKnowledgeChunk.id,
      content: dbSchema.aiKnowledgeChunk.content,
      contentHash: dbSchema.aiKnowledgeChunk.contentHash,
      title: dbSchema.aiKnowledgeChunk.title,
      sourceKind: dbSchema.aiKnowledgeChunk.sourceKind,
      sourcePath: dbSchema.aiKnowledgeChunk.sourcePath,
      locale: dbSchema.aiKnowledgeChunk.locale,
      visibility: dbSchema.aiKnowledgeChunk.visibility,
      internalOnly: dbSchema.aiKnowledgeChunk.internalOnly,
      organizationId: dbSchema.aiKnowledgeChunk.organizationId,
      classroomId: dbSchema.aiKnowledgeChunk.classroomId,
      vectorStatus: dbSchema.aiKnowledgeChunk.vectorStatus,
      documentIndexStatus: dbSchema.aiKnowledgeDocument.indexStatus,
    })
    .from(dbSchema.aiKnowledgeChunk)
    .innerJoin(
      dbSchema.aiKnowledgeDocument,
      eq(dbSchema.aiKnowledgeChunk.documentId, dbSchema.aiKnowledgeDocument.id),
    )
    .where(inArray(dbSchema.aiKnowledgeChunk.id, chunkIds));

  type KnowledgeChunkRow = {
    id: string;
    content: string;
    contentHash: string;
    title: string;
    sourceKind: string;
    sourcePath: string;
    locale: string;
    visibility: string;
    internalOnly: boolean;
    organizationId: string | null;
    classroomId: string | null;
    vectorStatus: string;
    documentIndexStatus: string;
  };
  type CandidateChunk = {
    id: string;
    content: string;
    contentHash: string;
    title: string;
    sourceKind: AiSourceKind;
    sourcePath: string;
    chunkId: string;
    visibility: AiSourceVisibility;
    internalOnly: boolean;
    score: number;
    locale: string;
    organizationId: string | null;
    classroomId: string | null;
    vectorStatus: string;
    documentIndexStatus: string;
  };

  const candidates = (rows as KnowledgeChunkRow[])
    .map((row) => {
      const match = matchById.get(row.id);
      return {
        id: row.id,
        content: row.content,
        contentHash: row.contentHash,
        title: row.title,
        sourceKind: normalizeSourceKind(row.sourceKind),
        sourcePath: row.sourcePath,
        chunkId: row.id,
        visibility: row.visibility as AiSourceVisibility,
        internalOnly: row.internalOnly,
        score: match?.score ?? 0,
        locale: row.locale,
        organizationId: row.organizationId,
        classroomId: row.classroomId,
        vectorStatus: row.vectorStatus,
        documentIndexStatus: row.documentIndexStatus,
      } satisfies CandidateChunk;
    })
    .filter((row) => row.vectorStatus === 'upserted' && row.documentIndexStatus === 'indexed');
  const scopedRows = (
    await Promise.all(
      candidates.map(async (row) =>
        (await sourceVisibilityPolicy.canReadSource({
          source: row,
          context,
          allowedVisibilities,
          internalOperator,
          locale,
        }))
          ? row
          : null,
      ),
    )
  ).filter((row): row is CandidateChunk => Boolean(row));

  const uniqueContent = new Set<string>();
  return scopedRows
    .sort((a, b) => b.score - a.score)
    .filter((row) => {
      const duplicate = uniqueContent.has(row.contentHash);
      uniqueContent.add(row.contentHash);
      return !duplicate;
    })
    .slice(0, 6)
    .map((row) => ({
      id: row.id,
      content: row.content,
      contentHash: row.contentHash,
      title: row.title,
      sourceKind: row.sourceKind,
      sourcePath: row.sourcePath,
      chunkId: row.chunkId,
      visibility: row.visibility,
      score: row.score,
    }));
};

export type RetrieveKnowledgeInput = Omit<
  Parameters<typeof retrieveKnowledge>[0],
  'env' | 'database' | 'embeddingProvider' | 'sourceVisibilityPolicy'
>;

export type DrizzleAiKnowledgeRetriever = KnowledgeRetriever<
  OrganizationClassroomAccess,
  RetrievedKnowledgeChunk
>;

export const createDrizzleAiKnowledgeRetriever = ({
  env,
  database,
  sourceVisibilityPolicy,
  embeddingProvider,
}: {
  env: AiRetrieverEnv;
  database: AuthRuntimeDatabase;
  sourceVisibilityPolicy: SourceVisibilityPolicy<OrganizationClassroomAccess>;
  embeddingProvider?: EmbeddingProvider;
}): DrizzleAiKnowledgeRetriever => ({
  retrieveKnowledge: (input) =>
    retrieveKnowledge({
      env,
      database,
      embeddingProvider,
      sourceVisibilityPolicy,
      ...input,
    }),
});
