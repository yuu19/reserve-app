import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import { generateEmbedding, type AiEmbeddingEnv } from './embedding.js';
import type { AiSourceKind, AiSourceVisibility } from './source-visibility.js';

export type IndexableKnowledgeDocument = {
  sourceKind: AiSourceKind;
  sourcePath: string;
  title: string;
  content: string;
  locale?: 'ja' | 'en';
  visibility?: AiSourceVisibility;
  internalOnly?: boolean;
  organizationId?: string | null;
  classroomId?: string | null;
  feature?: string | null;
  tags?: string[];
};

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

export const upsertKnowledgeDocument = async ({
  env,
  database,
  document,
  now = new Date(),
}: {
  env: AiIndexerEnv;
  database: AuthRuntimeDatabase;
  document: IndexableKnowledgeDocument;
  now?: Date;
}) => {
  if (!env.AI || !env.AI_KNOWLEDGE_INDEX) {
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
    const embedding = await generateEmbedding({
      env,
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
          visibility: document.visibility ?? 'authenticated',
          internalOnly: document.internalOnly ?? false,
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
