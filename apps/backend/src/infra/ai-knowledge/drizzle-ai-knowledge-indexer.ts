import type {
  EmbeddingProvider,
  IndexableKnowledgeDocument,
  KnowledgeIndexer,
  KnowledgeIndexResult,
} from '@repo/saas-chatbot-core';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import type { AiSourceKind, AiSourceVisibility } from '../../features/ai/source-visibility.js';
import {
  createWorkersAiEmbeddingProvider,
  type AiEmbeddingEnv,
} from '../ai/cloudflare-ai-embedding-provider.js';
import * as dbSchema from '../db/schema.js';

export type { IndexableKnowledgeDocument } from '@repo/saas-chatbot-core';

export type AiIndexerEnv = AiEmbeddingEnv & {
  AI_KNOWLEDGE_INDEX?: {
    upsert: (
      vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>,
    ) => Promise<unknown>;
  };
  AI_KNOWLEDGE_INDEX_NAME?: string;
};

const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');

const stripFrontmatter = (
  content: string,
): { frontmatter: Record<string, string>; body: string } => {
  if (!content.startsWith('---\n')) {
    return { frontmatter: {}, body: content };
  }
  const end = content.indexOf('\n---', 4);
  if (end < 0) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterText = content.slice(4, end);
  const frontmatter: Record<string, string> = {};
  for (const line of frontmatterText.split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    frontmatter[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return { frontmatter, body: content.slice(end + 4).trim() };
};

export const chunkKnowledgeContent = ({
  content,
  targetSize = 800,
  overlap = 100,
}: {
  content: string;
  targetSize?: number;
  overlap?: number;
}): string[] => {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let offset = 0;
  while (offset < normalized.length) {
    const end = Math.min(normalized.length, offset + targetSize);
    const slice = normalized.slice(offset, end).trim();
    if (slice) {
      chunks.push(slice);
    }
    if (end >= normalized.length) {
      break;
    }
    offset = Math.max(0, end - overlap);
  }
  return chunks;
};

/**
 * Markdown 系ナレッジファイルを探索し、frontmatter を index 可能な document に写像する。
 *
 * ここではビルド時のローカルファイルだけを読み、Vectorize への書き込みは
 * upsertKnowledgeDocument に委ねる。
 */
export const discoverMarkdownKnowledge = async ({
  rootDir,
  sourceKind,
  visibility,
  internalOnly,
}: {
  rootDir: string;
  sourceKind: AiSourceKind;
  visibility: AiSourceVisibility;
  internalOnly: boolean;
}): Promise<IndexableKnowledgeDocument[]> => {
  const documents: IndexableKnowledgeDocument[] = [];
  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!/\.(md|mdx|svx|svelte\.md)$/u.test(entry.name)) {
        continue;
      }
      const raw = await fs.readFile(fullPath, 'utf8');
      const { frontmatter, body } = stripFrontmatter(raw);
      const title =
        frontmatter.title ||
        body.match(/^#\s+(.+)$/mu)?.[1]?.trim() ||
        path.basename(entry.name).replace(/\.(md|mdx|svx|svelte\.md)$/u, '');
      documents.push({
        sourceKind,
        sourcePath: path.relative(process.cwd(), fullPath),
        title,
        content: body,
        locale: frontmatter.locale === 'en' ? 'en' : 'ja',
        visibility,
        internalOnly,
        feature: frontmatter.feature || null,
      });
    }
  };

  await walk(rootDir);
  return documents;
};

/**
 * D1 のナレッジ文書・chunk record と対応する Vectorize vector を upsert する。
 *
 * D1 が index lifecycle と content hash を保持し、Vectorize には検索用の
 * vector と lookup 用メタデータだけを渡す。
 */
export const upsertKnowledgeDocument = async ({
  env,
  database,
  embeddingProvider = createWorkersAiEmbeddingProvider({ env }),
  document,
  now = new Date(),
}: {
  env: AiIndexerEnv;
  database: AuthRuntimeDatabase;
  embeddingProvider?: EmbeddingProvider;
  document: IndexableKnowledgeDocument;
  now?: Date;
}): Promise<KnowledgeIndexResult> => {
  if (!embeddingProvider.isConfigured || !env.AI_KNOWLEDGE_INDEX) {
    throw new Error('Workers AI and Vectorize bindings are required for indexing.');
  }

  const checksum = hashText(document.content);
  const documentId = hashText(
    `${document.sourceKind}:${document.sourcePath}:${document.organizationId ?? ''}:${document.classroomId ?? ''}`,
  );
  const chunks = chunkKnowledgeContent({ content: document.content });

  await database
    .insert(dbSchema.aiKnowledgeDocument)
    .values({
      id: documentId,
      sourceKind: document.sourceKind,
      sourcePath: document.sourcePath,
      title: document.title,
      locale: document.locale ?? 'ja',
      visibility: document.visibility ?? 'authenticated',
      internalOnly: document.internalOnly ?? false,
      organizationId: document.organizationId ?? null,
      classroomId: document.classroomId ?? null,
      feature: document.feature ?? null,
      checksum,
      indexStatus: 'pending',
      indexedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: dbSchema.aiKnowledgeDocument.id,
      set: {
        title: document.title,
        locale: document.locale ?? 'ja',
        visibility: document.visibility ?? 'authenticated',
        internalOnly: document.internalOnly ?? false,
        organizationId: document.organizationId ?? null,
        classroomId: document.classroomId ?? null,
        feature: document.feature ?? null,
        checksum,
        indexStatus: 'pending',
        lastError: null,
        updatedAt: now,
      },
    });

  let upserted = 0;
  for (const [chunkIndex, content] of chunks.entries()) {
    const contentHash = hashText(content);
    const chunkId = hashText(`${documentId}:${chunkIndex}:${contentHash}`);
    const embedding = await embeddingProvider.generateEmbedding({
      text: content,
      cache: true,
    });

    await database
      .insert(dbSchema.aiKnowledgeChunk)
      .values({
        id: chunkId,
        documentId,
        chunkIndex,
        content,
        contentHash,
        title: document.title,
        sourceKind: document.sourceKind,
        sourcePath: document.sourcePath,
        locale: document.locale ?? 'ja',
        visibility: document.visibility ?? 'authenticated',
        internalOnly: document.internalOnly ?? false,
        organizationId: document.organizationId ?? null,
        classroomId: document.classroomId ?? null,
        feature: document.feature ?? null,
        tagsJson: document.tags ? JSON.stringify(document.tags) : null,
        indexedAt: now,
        vectorStatus: 'pending',
      })
      .onConflictDoUpdate({
        target: dbSchema.aiKnowledgeChunk.id,
        set: {
          content,
          contentHash,
          title: document.title,
          sourceKind: document.sourceKind,
          sourcePath: document.sourcePath,
          locale: document.locale ?? 'ja',
          visibility: document.visibility ?? 'authenticated',
          internalOnly: document.internalOnly ?? false,
          organizationId: document.organizationId ?? null,
          classroomId: document.classroomId ?? null,
          feature: document.feature ?? null,
          tagsJson: document.tags ? JSON.stringify(document.tags) : null,
          indexedAt: now,
          vectorStatus: 'pending',
        },
      });

    await env.AI_KNOWLEDGE_INDEX.upsert([
      {
        id: chunkId,
        values: embedding.vector,
        metadata: {
          sourceKind: document.sourceKind,
          locale: document.locale ?? 'ja',
          visibility: document.visibility ?? 'authenticated',
          internalOnly: document.internalOnly ?? false,
          organizationId: document.organizationId ?? '',
          classroomId: document.classroomId ?? '',
          feature: document.feature ?? 'general',
        },
      },
    ]);

    await database
      .update(dbSchema.aiKnowledgeChunk)
      .set({
        vectorStatus: 'upserted',
        indexedAt: now,
      })
      .where(eq(dbSchema.aiKnowledgeChunk.id, chunkId));
    upserted += 1;
  }

  await database
    .update(dbSchema.aiKnowledgeDocument)
    .set({
      indexStatus: 'indexed',
      indexedAt: now,
      updatedAt: now,
    })
    .where(eq(dbSchema.aiKnowledgeDocument.id, documentId));

  return {
    documentId,
    chunksUpserted: upserted,
  };
};

export type UpsertKnowledgeDocumentInput = Omit<
  Parameters<typeof upsertKnowledgeDocument>[0],
  'env' | 'database' | 'embeddingProvider'
>;

export type DrizzleAiKnowledgeIndexer = KnowledgeIndexer<IndexableKnowledgeDocument>;

export const createDrizzleAiKnowledgeIndexer = ({
  env,
  database,
  embeddingProvider,
}: {
  env: AiIndexerEnv;
  database: AuthRuntimeDatabase;
  embeddingProvider?: EmbeddingProvider;
}): DrizzleAiKnowledgeIndexer => ({
  upsertKnowledgeDocument: (input) =>
    upsertKnowledgeDocument({
      env,
      database,
      embeddingProvider,
      ...input,
    }),
});
