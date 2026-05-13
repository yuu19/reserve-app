#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const backendRoot = path.join(repoRoot, 'apps/backend');
const roots = [
  { sourceKind: 'docs', dir: path.join(repoRoot, 'apps/docs'), visibility: 'authenticated' },
  {
    sourceKind: 'docs',
    dir: path.join(repoRoot, 'docs'),
    visibility: 'admin',
    internalOnly: true,
  },
  {
    sourceKind: 'specs',
    dir: path.join(repoRoot, 'specs'),
    visibility: 'admin',
    internalOnly: true,
  },
];
const ignoredDirs = new Set([
  '.git',
  '.svelte-kit',
  '.turbo',
  '.wrangler',
  'build',
  'dist',
  'node_modules',
  'test-results',
]);
const defaultAccountCachePath = path.join(
  repoRoot,
  'node_modules/.cache/wrangler/wrangler-account.json',
);
const defaultD1Database = 'reserve-app';
const defaultEmbeddingModel = '@cf/baai/bge-m3';
const defaultGatewayId = 'reserve-app-ai';
const defaultVectorIndexName = 'reserve-app-knowledge';

const hashText = (value) => createHash('sha256').update(value).digest('hex');

const stripFrontmatter = (content) => {
  if (!content.startsWith('---\n')) {
    return { frontmatter: {}, body: content };
  }
  const end = content.indexOf('\n---', 4);
  if (end < 0) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterText = content.slice(4, end);
  const frontmatter = {};
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

const chunkKnowledgeContent = ({ content, targetSize = 800, overlap = 100 }) => {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return [];
  }

  const chunks = [];
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

const walkMarkdown = async (dir) => {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }
      files.push(...(await walkMarkdown(fullPath)));
      continue;
    }
    if (/\.(md|mdx|svx|svelte\.md)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
};

const discoverKnowledgeDocuments = async () => {
  const discovered = [];
  for (const root of roots) {
    const files = await walkMarkdown(root.dir);
    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      const { frontmatter, body } = stripFrontmatter(raw);
      const title =
        frontmatter.title ||
        body.match(/^#\s+(.+)$/mu)?.[1]?.trim() ||
        path.basename(file).replace(/\.(md|mdx|svx|svelte\.md)$/u, '');
      discovered.push({
        sourceKind: root.sourceKind,
        sourcePath: path.relative(repoRoot, file),
        title,
        content: body,
        locale: frontmatter.locale === 'en' ? 'en' : 'ja',
        visibility: root.visibility,
        internalOnly: Boolean(root.internalOnly),
        feature: frontmatter.feature || null,
        checksum: hashText(body),
      });
    }
  }
  discovered.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  return discovered;
};

const readAccountId = async () => {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) {
    return process.env.CLOUDFLARE_ACCOUNT_ID;
  }
  if (process.env.CF_ACCOUNT_ID) {
    return process.env.CF_ACCOUNT_ID;
  }
  const raw = await fs.readFile(defaultAccountCachePath, 'utf8');
  return JSON.parse(raw).account.id;
};

const isNumberArray = (value) =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

const readEmbeddingVector = (payload) => {
  const value = payload?.result ?? payload;
  if (Array.isArray(value?.data) && isNumberArray(value.data[0])) {
    return value.data[0];
  }
  if (Array.isArray(value?.response) && isNumberArray(value.response[0])) {
    return value.response[0];
  }
  if (isNumberArray(value?.embedding)) {
    return value.embedding;
  }
  if (isNumberArray(value?.vector)) {
    return value.vector;
  }
  throw new Error('Workers AI embedding response did not include a vector.');
};

const readEmbeddingShape = (payload, vector) => {
  const value = payload?.result ?? payload;
  if (Array.isArray(value?.shape) && value.shape.every((entry) => typeof entry === 'number')) {
    return value.shape;
  }
  return [1, vector.length];
};

const generateEmbedding = async ({ accountId, gatewayId, token, model, text }) => {
  const url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/${model}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  const payload = await response.json().catch(async () => ({ error: await response.text() }));
  if (!response.ok || payload.success === false) {
    throw new Error(`Workers AI embedding failed: ${JSON.stringify(payload)}`);
  }
  const vector = readEmbeddingVector(payload);
  return { vector, shape: readEmbeddingShape(payload, vector) };
};

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
const sqlValue = (value) => {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  return sqlString(value);
};

const chunked = (values, size) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const run = async (command, args, { env = process.env } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: backendRoot,
      env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
      }
    });
  });

const runWrangler = async (args) => {
  const env = { ...process.env };
  if (!process.env.WRANGLER_CLOUDFLARE_API_TOKEN) {
    delete env.CLOUDFLARE_API_TOKEN;
  } else {
    env.CLOUDFLARE_API_TOKEN = process.env.WRANGLER_CLOUDFLARE_API_TOKEN;
  }
  delete env.CF_AI_GATEWAY_TOKEN;
  await run('npx', ['wrangler', ...args], { env });
};

const writeD1File = async (filePath, statements) => {
  await fs.writeFile(filePath, `${statements.join('\n')}\n`, 'utf8');
};

const executeD1File = async (databaseName, filePath) => {
  await runWrangler(['d1', 'execute', databaseName, '--remote', '--file', filePath, '--yes']);
};

const buildRunStartSql = ({ runId, now, documentsSeen, embeddingModel, vectorIndexName }) => [
  `INSERT INTO ai_knowledge_index_run (id, source_root, status, started_at, documents_seen, documents_indexed, chunks_upserted, chunks_failed, embedding_model, embedding_shape_json, vector_index_name, error_summary) VALUES (${sqlValue(runId)}, 'markdown', 'running', ${now}, ${documentsSeen}, 0, 0, 0, ${sqlValue(embeddingModel)}, NULL, ${sqlValue(vectorIndexName)}, NULL) ON CONFLICT(id) DO UPDATE SET status = 'running', started_at = ${now}, finished_at = NULL, documents_seen = ${documentsSeen}, documents_indexed = 0, chunks_upserted = 0, chunks_failed = 0, embedding_model = ${sqlValue(embeddingModel)}, embedding_shape_json = NULL, vector_index_name = ${sqlValue(vectorIndexName)}, error_summary = NULL;`,
];

const buildPendingSql = ({ documents, chunks, now }) => {
  const statements = [];
  for (const document of documents) {
    statements.push(
      `INSERT INTO ai_knowledge_document (id, source_kind, source_path, title, locale, visibility, internal_only, organization_id, classroom_id, feature, checksum, index_status, indexed_at, last_error, created_at, updated_at) VALUES (${sqlValue(document.id)}, ${sqlValue(document.sourceKind)}, ${sqlValue(document.sourcePath)}, ${sqlValue(document.title)}, ${sqlValue(document.locale)}, ${sqlValue(document.visibility)}, ${sqlValue(document.internalOnly)}, NULL, NULL, ${sqlValue(document.feature)}, ${sqlValue(document.checksum)}, 'pending', NULL, NULL, ${now}, ${now}) ON CONFLICT(id) DO UPDATE SET title = ${sqlValue(document.title)}, locale = ${sqlValue(document.locale)}, visibility = ${sqlValue(document.visibility)}, internal_only = ${sqlValue(document.internalOnly)}, feature = ${sqlValue(document.feature)}, checksum = ${sqlValue(document.checksum)}, index_status = 'pending', last_error = NULL, updated_at = ${now};`,
    );
  }
  for (const chunk of chunks) {
    statements.push(
      `INSERT INTO ai_knowledge_chunk (id, document_id, chunk_index, content, content_hash, title, source_kind, source_path, locale, visibility, internal_only, organization_id, classroom_id, feature, tags_json, indexed_at, vector_status) VALUES (${sqlValue(chunk.id)}, ${sqlValue(chunk.documentId)}, ${chunk.chunkIndex}, ${sqlValue(chunk.content)}, ${sqlValue(chunk.contentHash)}, ${sqlValue(chunk.title)}, ${sqlValue(chunk.sourceKind)}, ${sqlValue(chunk.sourcePath)}, ${sqlValue(chunk.locale)}, ${sqlValue(chunk.visibility)}, ${sqlValue(chunk.internalOnly)}, NULL, NULL, ${sqlValue(chunk.feature)}, NULL, ${now}, 'pending') ON CONFLICT(id) DO UPDATE SET content = ${sqlValue(chunk.content)}, content_hash = ${sqlValue(chunk.contentHash)}, title = ${sqlValue(chunk.title)}, visibility = ${sqlValue(chunk.visibility)}, internal_only = ${sqlValue(chunk.internalOnly)}, indexed_at = ${now}, vector_status = 'pending';`,
    );
  }
  return statements;
};

const buildSuccessSql = ({ runId, documents, chunks, now, embeddingShape }) => {
  const statements = [];
  const currentDocumentIds = documents.map((entry) => sqlValue(entry.id)).join(', ');
  const currentChunkIds = chunks.map((entry) => sqlValue(entry.id)).join(', ');
  const currentSourceKinds = [...new Set(documents.map((entry) => entry.sourceKind))]
    .map((entry) => sqlValue(entry))
    .join(', ');

  for (const group of chunked(chunks, 50)) {
    statements.push(
      `UPDATE ai_knowledge_chunk SET vector_status = 'upserted', indexed_at = ${now} WHERE id IN (${group.map((entry) => sqlValue(entry.id)).join(', ')});`,
    );
  }
  for (const group of chunked(documents, 50)) {
    statements.push(
      `UPDATE ai_knowledge_document SET index_status = 'indexed', indexed_at = ${now}, updated_at = ${now} WHERE id IN (${group.map((entry) => sqlValue(entry.id)).join(', ')});`,
    );
  }
  if (documents.length > 0) {
    const oldChunkPredicate = chunks.length > 0 ? `id NOT IN (${currentChunkIds})` : '1 = 1';
    statements.push(
      `UPDATE ai_knowledge_chunk SET vector_status = 'stale', indexed_at = ${now} WHERE document_id IN (${currentDocumentIds}) AND ${oldChunkPredicate};`,
    );
    statements.push(
      `UPDATE ai_knowledge_chunk SET vector_status = 'stale', indexed_at = ${now} WHERE document_id IN (SELECT id FROM ai_knowledge_document WHERE source_kind IN (${currentSourceKinds}) AND organization_id IS NULL AND classroom_id IS NULL AND id NOT IN (${currentDocumentIds}));`,
    );
    statements.push(
      `UPDATE ai_knowledge_document SET index_status = 'stale', updated_at = ${now} WHERE source_kind IN (${currentSourceKinds}) AND organization_id IS NULL AND classroom_id IS NULL AND id NOT IN (${currentDocumentIds});`,
    );
  }
  statements.push(
    `UPDATE ai_knowledge_index_run SET status = 'succeeded', finished_at = ${now}, documents_indexed = ${documents.length}, chunks_upserted = ${chunks.length}, chunks_failed = 0, embedding_shape_json = ${sqlValue(JSON.stringify(embeddingShape))}, error_summary = NULL WHERE id = ${sqlValue(runId)};`,
  );
  return statements;
};

const buildFailedSql = ({ runId, now, chunksFailed, error }) => [
  `UPDATE ai_knowledge_index_run SET status = 'failed', finished_at = ${now}, chunks_failed = ${chunksFailed}, error_summary = ${sqlValue(String(error).slice(0, 1000))} WHERE id = ${sqlValue(runId)};`,
];

const applyIndexing = async (documents) => {
  const token = process.env.CF_AI_GATEWAY_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error('Set CF_AI_GATEWAY_TOKEN to call Workers AI through AI Gateway.');
  }

  const accountId = await readAccountId();
  const gatewayId = process.env.AI_GATEWAY_ID || defaultGatewayId;
  const embeddingModel = process.env.AI_EMBEDDING_MODEL || defaultEmbeddingModel;
  const vectorIndexName = process.env.AI_KNOWLEDGE_INDEX_NAME || defaultVectorIndexName;
  const d1Database = process.env.AI_KNOWLEDGE_D1_DATABASE || defaultD1Database;
  const runId = `index-run:${Date.now()}`;
  const startedAt = Date.now();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reserve-app-ai-index-'));
  const runStartSqlPath = path.join(tempDir, 'run-start.sql');
  const pendingSqlPath = path.join(tempDir, 'pending.sql');
  const successSqlPath = path.join(tempDir, 'success.sql');
  const failedSqlPath = path.join(tempDir, 'failed.sql');
  const vectorsPath = path.join(tempDir, 'vectors.ndjson');

  const documentsWithIds = documents.map((document) => ({
    ...document,
    id: hashText(`${document.sourceKind}:${document.sourcePath}::`),
  }));
  const chunkInputs = documentsWithIds.flatMap((document) =>
    chunkKnowledgeContent({ content: document.content }).map((content, chunkIndex) => {
      const contentHash = hashText(content);
      return {
        id: hashText(`${document.id}:${chunkIndex}:${contentHash}`),
        documentId: document.id,
        chunkIndex,
        content,
        contentHash,
        title: document.title,
        sourceKind: document.sourceKind,
        sourcePath: document.sourcePath,
        locale: document.locale,
        visibility: document.visibility,
        internalOnly: document.internalOnly,
        feature: document.feature,
      };
    }),
  );

  await writeD1File(
    runStartSqlPath,
    buildRunStartSql({
      runId,
      now: startedAt,
      documentsSeen: documentsWithIds.length,
      embeddingModel,
      vectorIndexName,
    }),
  );
  await executeD1File(d1Database, runStartSqlPath);

  let embeddingShape = null;
  const vectorLines = [];
  try {
    for (const [index, chunk] of chunkInputs.entries()) {
      const embedding = await generateEmbedding({
        accountId,
        gatewayId,
        token,
        model: embeddingModel,
        text: chunk.content,
      });
      embeddingShape ??= embedding.shape;
      vectorLines.push(
        JSON.stringify({
          id: chunk.id,
          values: embedding.vector,
          metadata: {
            sourceKind: chunk.sourceKind,
            locale: chunk.locale,
            visibility: chunk.visibility,
            internalOnly: chunk.internalOnly,
            organizationId: '',
            classroomId: '',
            feature: chunk.feature ?? 'general',
          },
        }),
      );
      if ((index + 1) % 10 === 0 || index + 1 === chunkInputs.length) {
        console.error(`Generated embeddings: ${index + 1}/${chunkInputs.length}`);
      }
    }

    await fs.writeFile(vectorsPath, `${vectorLines.join('\n')}\n`, 'utf8');
    await writeD1File(
      pendingSqlPath,
      buildPendingSql({ documents: documentsWithIds, chunks: chunkInputs, now: Date.now() }),
    );
    await executeD1File(d1Database, pendingSqlPath);
    await runWrangler(['vectorize', 'upsert', vectorIndexName, '--file', vectorsPath]);
    await writeD1File(
      successSqlPath,
      buildSuccessSql({
        runId,
        documents: documentsWithIds,
        chunks: chunkInputs,
        now: Date.now(),
        embeddingShape,
      }),
    );
    await executeD1File(d1Database, successSqlPath);
  } catch (error) {
    await writeD1File(
      failedSqlPath,
      buildFailedSql({
        runId,
        now: Date.now(),
        chunksFailed: chunkInputs.length,
        error,
      }),
    );
    await executeD1File(d1Database, failedSqlPath).catch(() => {});
    throw error;
  }

  return {
    accountId,
    gatewayId,
    vectorIndexName,
    d1Database,
    runId,
    documentsIndexed: documentsWithIds.length,
    chunksUpserted: chunkInputs.length,
    embeddingModel,
    embeddingShape,
    tempDir,
  };
};

const main = async () => {
  const apply = process.argv.includes('--apply');
  const documents = await discoverKnowledgeDocuments();

  if (apply) {
    const result = await applyIndexing(documents);
    console.log(JSON.stringify({ message: 'Knowledge indexing completed.', ...result }, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        message:
          'Knowledge discovery completed. Re-run with --apply and CF_AI_GATEWAY_TOKEN to upsert these sources into production D1 and Vectorize.',
        documents: documents.map(({ content: _content, ...document }) => document),
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
