import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseArgs } from '../../../scripts/index-ai-knowledge.mjs';
import {
  chunkKnowledgeContent,
  createDefaultKnowledgeSourceRoots,
  discoverKnowledgeDocuments,
  discoverMarkdownKnowledge,
} from '../../../scripts/ai-knowledge-source-loader.mjs';
import {
  buildPendingSql,
  buildSuccessSql,
  buildVectorMetadata,
  createKnowledgeIndexingPlan,
  runKnowledgeIndexing,
} from '../../../scripts/ai-knowledge-indexing-usecase.mjs';

const tempDirs: string[] = [];

const createTempDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reserve-app-ai-indexer-'));
  tempDirs.push(dir);
  return dir;
};

const writeFile = async (rootDir: string, filePath: string, content: string) => {
  const fullPath = path.join(rootDir, filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
};

const createDocument = (overrides: Record<string, unknown> = {}) => ({
  sourceKind: 'docs',
  sourcePath: 'apps/docs/manual.md',
  title: 'Manual',
  content: '# Manual\n本文',
  locale: 'ja',
  visibility: 'authenticated',
  internalOnly: false,
  organizationId: null,
  storeId: null,
  feature: null,
  tags: [],
  ...overrides,
});

describe('AI ナレッジインデクサー', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it('長いナレッジ本文を重なり付きで分割し空本文を無視する', () => {
    expect(chunkKnowledgeContent({ content: '   \n\n ' })).toEqual([]);

    const chunks = chunkKnowledgeContent({
      content: '0123456789abcdefghij',
      targetSize: 10,
      overlap: 3,
    });

    expect(chunks).toEqual(['0123456789', '789abcdefg', 'efghij']);
  });

  it('安定した既定のナレッジソースルートを定義する', () => {
    expect(
      createDefaultKnowledgeSourceRoots({ repoRoot: '/repo' }).map(
        ({ id, repoRelativePrefix, sourceKind, visibility, internalOnly }) => ({
          id,
          repoRelativePrefix,
          sourceKind,
          visibility,
          internalOnly,
        }),
      ),
    ).toEqual([
      {
        id: 'app-docs',
        repoRelativePrefix: 'apps/docs',
        sourceKind: 'docs',
        visibility: 'authenticated',
        internalOnly: false,
      },
      {
        id: 'internal-docs',
        repoRelativePrefix: 'docs',
        sourceKind: 'docs',
        visibility: 'admin',
        internalOnly: true,
      },
      {
        id: 'specs',
        repoRelativePrefix: 'specs',
        sourceKind: 'specs',
        visibility: 'admin',
        internalOnly: true,
      },
    ]);
  });

  it('frontmatter メタデータとタイトルを持つ Markdown・spec 文書を検出する', async () => {
    const rootDir = await createTempDir();
    await writeFile(
      rootDir,
      'manual.md',
      [
        '---',
        'title: "予約FAQ"',
        'locale: ja',
        'feature: booking',
        'tags: booking, faq',
        '---',
        '',
        '# 見出し',
        '本文',
      ].join('\n'),
    );
    await writeFile(rootDir, 'nested/ignored.txt', 'ignored');

    const documents = await discoverMarkdownKnowledge({
      repoRoot: rootDir,
      rootDir,
      sourceKind: 'docs',
      visibility: 'authenticated',
      internalOnly: false,
    });

    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      sourceKind: 'docs',
      sourcePath: 'manual.md',
      title: '予約FAQ',
      locale: 'ja',
      visibility: 'authenticated',
      internalOnly: false,
      feature: 'booking',
      tags: ['booking', 'faq'],
    });
    expect(documents[0]?.content).toContain('# 見出し');
  });

  it('リポジトリ検出中にルート可視性と内部専用ポリシーを維持する', async () => {
    const repoRoot = await createTempDir();
    await writeFile(
      repoRoot,
      'apps/docs/src/routes/manuals/common/ai-chatbot/+page.md',
      ['---', 'title: "AI Chat"', 'locale: en', 'feature: ai-chatbot', '---', '', 'Guide'].join(
        '\n',
      ),
    );
    await writeFile(repoRoot, 'docs/operator.md', '# Operator note');
    await writeFile(repoRoot, 'specs/004-ai-chatbot/spec.md', '# Spec');

    const documents = await discoverKnowledgeDocuments({ repoRoot });
    const byPath = new Map(documents.map((document) => [document.sourcePath, document]));

    expect(byPath.get('apps/docs/src/routes/manuals/common/ai-chatbot/+page.md')).toMatchObject({
      sourceKind: 'docs',
      visibility: 'authenticated',
      internalOnly: false,
      feature: 'ai-chatbot',
      locale: 'en',
    });
    expect(byPath.get('docs/operator.md')).toMatchObject({
      sourceKind: 'docs',
      visibility: 'admin',
      internalOnly: true,
      locale: 'ja',
    });
    expect(byPath.get('specs/004-ai-chatbot/spec.md')).toMatchObject({
      sourceKind: 'specs',
      visibility: 'admin',
      internalOnly: true,
    });
  });

  it('dry-run では D1・Vectorize・Workers AI 依存を呼び出さない', async () => {
    const result = await runKnowledgeIndexing({
      documents: [createDocument()],
      apply: false,
      repoRoot: '/unused',
      dependencies: {
        readAccountId: () => {
          throw new Error('readAccountId should not be called');
        },
        executeD1File: () => {
          throw new Error('executeD1File should not be called');
        },
        upsertVectors: () => {
          throw new Error('upsertVectors should not be called');
        },
        generateEmbedding: () => {
          throw new Error('generateEmbedding should not be called');
        },
      },
    });

    expect(result).toMatchObject({
      mode: 'dry-run',
      documentsSeen: 1,
      chunksPrepared: 1,
    });
  });

  it('引数なしを dry-run として扱い競合する apply モードを拒否する', () => {
    expect(parseArgs([])).toMatchObject({
      apply: false,
      dryRun: true,
      sourceRoot: null,
      sourcePath: null,
    });
    expect(parseArgs(['--dry-run'])).toMatchObject({
      apply: false,
      dryRun: true,
    });
    expect(parseArgs(['--apply'])).toMatchObject({
      apply: true,
      dryRun: false,
    });
    expect(parseArgs(['--source-root', 'app-docs'])).toMatchObject({
      apply: false,
      dryRun: true,
      sourceRoot: 'app-docs',
      sourcePath: null,
    });
    expect(
      parseArgs(['--source-root', 'specs', '--source-path', './specs/004-ai-chatbot/spec.md']),
    ).toMatchObject({
      sourceRoot: 'specs',
      sourcePath: 'specs/004-ai-chatbot/spec.md',
    });
    expect(() => parseArgs(['--dry-run', '--apply'])).toThrow(
      'Use either --dry-run or --apply, not both.',
    );
    expect(() => parseArgs(['--source-root', 'unknown'])).toThrow(
      'Unknown --source-root unknown. Expected one of: app-docs, internal-docs, specs.',
    );
    expect(() => parseArgs(['--unknown'])).toThrow('Unknown option: --unknown');
  });

  it('リポジトリ相対ソースパスで検出結果を絞り込む', async () => {
    const repoRoot = await createTempDir();
    await writeFile(repoRoot, 'apps/docs/manual-a.md', '# A');
    await writeFile(repoRoot, 'apps/docs/manual-b.md', '# B');

    const documents = await discoverKnowledgeDocuments({
      repoRoot,
      sourcePath: './apps/docs/manual-a.md',
    });

    expect(documents.map((document) => document.sourcePath)).toEqual(['apps/docs/manual-a.md']);
  });

  it('ソースルートとリポジトリ相対ソースパスを組み合わせて検出結果を絞り込む', async () => {
    const repoRoot = await createTempDir();
    await writeFile(repoRoot, 'apps/docs/manual-a.md', '# A');
    await writeFile(repoRoot, 'docs/operator.md', '# Operator');
    await writeFile(repoRoot, 'specs/004-ai-chatbot/spec.md', '# Spec');

    await expect(
      discoverKnowledgeDocuments({
        repoRoot,
        sourceRoot: 'unknown',
      }),
    ).rejects.toThrow(
      'Unknown --source-root unknown. Expected one of: app-docs, internal-docs, specs.',
    );

    const internalDocuments = await discoverKnowledgeDocuments({
      repoRoot,
      sourceRoot: 'internal-docs',
    });
    expect(internalDocuments.map((document) => document.sourcePath)).toEqual(['docs/operator.md']);

    const selectedAppDocument = await discoverKnowledgeDocuments({
      repoRoot,
      sourceRoot: 'app-docs',
      sourcePath: './apps/docs/manual-a.md',
    });
    expect(selectedAppDocument.map((document) => document.sourcePath)).toEqual([
      'apps/docs/manual-a.md',
    ]);

    await expect(
      discoverKnowledgeDocuments({
        repoRoot,
        sourceRoot: 'app-docs',
        sourcePath: 'docs/operator.md',
      }),
    ).rejects.toThrow('No knowledge source matched --source-path docs/operator.md');
  });

  it('source-path がナレッジソースに一致しない場合は失敗する', async () => {
    const repoRoot = await createTempDir();
    await writeFile(repoRoot, 'apps/docs/manual-a.md', '# A');

    await expect(
      discoverKnowledgeDocuments({
        repoRoot,
        sourcePath: 'apps/docs/missing.md',
      }),
    ).rejects.toThrow('No knowledge source matched --source-path apps/docs/missing.md');
  });

  it('source-path apply では古い SQL を対象ドキュメントに限定する', () => {
    const plan = createKnowledgeIndexingPlan({
      documents: [createDocument({ sourcePath: 'apps/docs/manual-a.md' })],
    });

    const statements = buildSuccessSql({
      runId: 'run-1',
      documents: plan.documents,
      chunks: plan.chunks,
      now: 1000,
      embeddingShape: [1, 1024],
      staleScope: 'targeted',
    });
    const sql = statements.join('\n');

    expect(sql).toContain("UPDATE ai_knowledge_chunk SET vector_status = 'stale'");
    expect(sql).toContain('WHERE document_id IN');
    expect(sql).not.toContain('source_kind IN');
    expect(sql).not.toContain("UPDATE ai_knowledge_document SET index_status = 'stale'");
  });

  it('full apply では source-kind 全体の古い SQL を維持する', () => {
    const plan = createKnowledgeIndexingPlan({
      documents: [createDocument({ sourcePath: 'apps/docs/manual-a.md' })],
    });

    const statements = buildSuccessSql({
      runId: 'run-1',
      documents: plan.documents,
      chunks: plan.chunks,
      now: 1000,
      embeddingShape: [1, 1024],
      staleScope: 'full',
    });
    const sql = statements.join('\n');

    expect(sql).toContain("source_kind IN ('docs')");
    expect(sql).toContain('organization_id IS NULL AND store_id IS NULL');
    expect(sql).toContain("UPDATE ai_knowledge_document SET index_status = 'stale'");
  });

  it('source-root apply では古い SQL を選択されたソースルートに限定する', () => {
    const plan = createKnowledgeIndexingPlan({
      documents: [createDocument({ sourcePath: 'apps/docs/manual-a.md' })],
    });

    const statements = buildSuccessSql({
      runId: 'run-1',
      documents: plan.documents,
      chunks: plan.chunks,
      now: 1000,
      embeddingShape: [1, 1024],
      staleScope: {
        mode: 'source-root',
        sourceKind: 'docs',
        sourcePathPrefix: 'apps/docs',
      },
    });
    const sql = statements.join('\n');

    expect(sql).toContain("source_kind = 'docs'");
    expect(sql).toContain("source_path = 'apps/docs' OR source_path LIKE 'apps/docs/%'");
    expect(sql).not.toContain("source_kind IN ('docs')");
    expect(sql).not.toContain("source_path LIKE 'docs/%'");
    expect(sql).toContain("UPDATE ai_knowledge_document SET index_status = 'stale'");
  });

  it('保留 SQL とベクトルメタデータにソース可視性メタデータを保存・更新する', () => {
    const plan = createKnowledgeIndexingPlan({
      documents: [
        createDocument({
          sourcePath: 'docs/operator.md',
          visibility: 'admin',
          internalOnly: true,
          organizationId: 'org-1',
          storeId: 'store-1',
          feature: 'billing',
          tags: ['operator', 'billing'],
        }),
      ],
    });

    const statements = buildPendingSql({
      documents: plan.documents,
      chunks: plan.chunks,
      now: 1000,
    });
    const sql = statements.join('\n');

    expect(sql).toContain('source_kind');
    expect(sql).toContain('source_path');
    expect(sql).toContain("'docs'");
    expect(sql).toContain("'docs/operator.md'");
    expect(sql).toContain("'admin'");
    expect(sql).toContain("'org-1'");
    expect(sql).toContain("'store-1'");
    expect(sql).toContain("'billing'");
    expect(sql).toContain('\'["operator","billing"]\'');
    expect(sql).toContain("source_kind = 'docs'");
    expect(sql).toContain("source_path = 'docs/operator.md'");
    expect(sql).toContain('internal_only = 1');
    expect(sql).toContain("organization_id = 'org-1'");
    expect(sql).toContain('tags_json');

    expect(buildVectorMetadata(plan.chunks[0])).toEqual({
      visibility: 'admin',
      internal_only: true,
      organization_id: 'org-1',
      store_id: 'store-1',
      feature: 'billing',
      locale: 'ja',
      source_kind: 'docs',
      source_path: 'docs/operator.md',
      tags_json: '["operator","billing"]',
    });
  });
});
