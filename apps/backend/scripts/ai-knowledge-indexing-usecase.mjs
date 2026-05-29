import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chunkKnowledgeContent } from './ai-knowledge-source-loader.mjs';

export const defaultD1Database = 'reserve-app';
export const defaultEmbeddingModel = '@cf/baai/bge-m3';
export const defaultGatewayId = 'reserve-app-ai';
export const defaultVectorIndexName = 'reserve-app-knowledge';

export const hashText = (value) => createHash('sha256').update(value).digest('hex');

export const chunked = (values, size) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

export const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

export const sqlValue = (value) => {
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

const escapeSqlLikePattern = (value) =>
  String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

const buildSourcePathPrefixPredicate = ({ sourcePathPrefix }) => {
  const escapedPrefix = escapeSqlLikePattern(sourcePathPrefix);
  return `(source_path = ${sqlValue(sourcePathPrefix)} OR source_path LIKE ${sqlValue(
    `${escapedPrefix}/%`,
  )} ESCAPE '\\')`;
};

const normalizeStaleScope = (staleScope) => {
  if (!staleScope || staleScope === 'full') {
    return { mode: 'full' };
  }
  if (staleScope === 'targeted') {
    return { mode: 'targeted' };
  }
  if (staleScope.mode === 'source-root' && staleScope.sourceKind && staleScope.sourcePathPrefix) {
    return staleScope;
  }
  throw new Error('Unknown knowledge indexing stale scope.');
};

const buildSourceRootDocumentPredicate = ({ sourceKind, sourcePathPrefix }) =>
  [
    `source_kind = ${sqlValue(sourceKind)}`,
    buildSourcePathPrefixPredicate({ sourcePathPrefix }),
    'organization_id IS NULL',
    'store_id IS NULL',
  ].join(' AND ');

const normalizeTags = (tags) => (Array.isArray(tags) ? tags.filter(Boolean) : []);

const tagsJsonValue = (tags) => {
  const normalized = normalizeTags(tags);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
};

const normalizeDocument = (document) => ({
  ...document,
  locale: document.locale ?? 'ja',
  visibility: document.visibility ?? 'authenticated',
  internalOnly: Boolean(document.internalOnly),
  organizationId: document.organizationId ?? null,
  storeId: document.storeId ?? null,
  feature: document.feature ?? null,
  tags: normalizeTags(document.tags),
});

export const createKnowledgeIndexingPlan = ({ documents }) => {
  const documentsWithIds = documents.map((rawDocument) => {
    const document = normalizeDocument(rawDocument);
    return {
      ...document,
      id: hashText(
        `${document.sourceKind}:${document.sourcePath}:${document.organizationId ?? ''}:${
          document.storeId ?? ''
        }`,
      ),
      checksum: hashText(document.content),
      tagsJson: tagsJsonValue(document.tags),
    };
  });

  const chunks = documentsWithIds.flatMap((document) =>
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
        organizationId: document.organizationId,
        storeId: document.storeId,
        feature: document.feature,
        tagsJson: document.tagsJson,
      };
    }),
  );

  return { documents: documentsWithIds, chunks };
};

export const buildRunStartSql = ({
  runId,
  now,
  documentsSeen,
  embeddingModel,
  vectorIndexName,
}) => [
  `INSERT INTO ai_knowledge_index_run (id, source_root, status, started_at, documents_seen, documents_indexed, chunks_upserted, chunks_failed, embedding_model, embedding_shape_json, vector_index_name, error_summary) VALUES (${sqlValue(runId)}, 'markdown', 'running', ${now}, ${documentsSeen}, 0, 0, 0, ${sqlValue(embeddingModel)}, NULL, ${sqlValue(vectorIndexName)}, NULL) ON CONFLICT(id) DO UPDATE SET status = 'running', started_at = ${now}, finished_at = NULL, documents_seen = ${documentsSeen}, documents_indexed = 0, chunks_upserted = 0, chunks_failed = 0, embedding_model = ${sqlValue(embeddingModel)}, embedding_shape_json = NULL, vector_index_name = ${sqlValue(vectorIndexName)}, error_summary = NULL;`,
];

export const buildPendingSql = ({ documents, chunks, now }) => {
  const statements = [];
  for (const document of documents) {
    statements.push(
      `INSERT INTO ai_knowledge_document (id, source_kind, source_path, title, locale, visibility, internal_only, organization_id, store_id, feature, checksum, index_status, indexed_at, last_error, created_at, updated_at) VALUES (${sqlValue(document.id)}, ${sqlValue(document.sourceKind)}, ${sqlValue(document.sourcePath)}, ${sqlValue(document.title)}, ${sqlValue(document.locale)}, ${sqlValue(document.visibility)}, ${sqlValue(document.internalOnly)}, ${sqlValue(document.organizationId)}, ${sqlValue(document.storeId)}, ${sqlValue(document.feature)}, ${sqlValue(document.checksum)}, 'pending', NULL, NULL, ${now}, ${now}) ON CONFLICT(id) DO UPDATE SET source_kind = ${sqlValue(document.sourceKind)}, source_path = ${sqlValue(document.sourcePath)}, title = ${sqlValue(document.title)}, locale = ${sqlValue(document.locale)}, visibility = ${sqlValue(document.visibility)}, internal_only = ${sqlValue(document.internalOnly)}, organization_id = ${sqlValue(document.organizationId)}, store_id = ${sqlValue(document.storeId)}, feature = ${sqlValue(document.feature)}, checksum = ${sqlValue(document.checksum)}, index_status = 'pending', indexed_at = NULL, last_error = NULL, updated_at = ${now};`,
    );
  }
  for (const chunk of chunks) {
    statements.push(
      `INSERT INTO ai_knowledge_chunk (id, document_id, chunk_index, content, content_hash, title, source_kind, source_path, locale, visibility, internal_only, organization_id, store_id, feature, tags_json, indexed_at, vector_status) VALUES (${sqlValue(chunk.id)}, ${sqlValue(chunk.documentId)}, ${chunk.chunkIndex}, ${sqlValue(chunk.content)}, ${sqlValue(chunk.contentHash)}, ${sqlValue(chunk.title)}, ${sqlValue(chunk.sourceKind)}, ${sqlValue(chunk.sourcePath)}, ${sqlValue(chunk.locale)}, ${sqlValue(chunk.visibility)}, ${sqlValue(chunk.internalOnly)}, ${sqlValue(chunk.organizationId)}, ${sqlValue(chunk.storeId)}, ${sqlValue(chunk.feature)}, ${sqlValue(chunk.tagsJson)}, ${now}, 'pending') ON CONFLICT(id) DO UPDATE SET document_id = ${sqlValue(chunk.documentId)}, chunk_index = ${chunk.chunkIndex}, content = ${sqlValue(chunk.content)}, content_hash = ${sqlValue(chunk.contentHash)}, title = ${sqlValue(chunk.title)}, source_kind = ${sqlValue(chunk.sourceKind)}, source_path = ${sqlValue(chunk.sourcePath)}, locale = ${sqlValue(chunk.locale)}, visibility = ${sqlValue(chunk.visibility)}, internal_only = ${sqlValue(chunk.internalOnly)}, organization_id = ${sqlValue(chunk.organizationId)}, store_id = ${sqlValue(chunk.storeId)}, feature = ${sqlValue(chunk.feature)}, tags_json = ${sqlValue(chunk.tagsJson)}, indexed_at = ${now}, vector_status = 'pending';`,
    );
  }
  return statements;
};

export const buildSuccessSql = ({
  runId,
  documents,
  chunks,
  now,
  embeddingShape,
  staleScope = 'full',
}) => {
  const statements = [];
  const normalizedStaleScope = normalizeStaleScope(staleScope);
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

    if (normalizedStaleScope.mode === 'full') {
      statements.push(
        `UPDATE ai_knowledge_chunk SET vector_status = 'stale', indexed_at = ${now} WHERE document_id IN (SELECT id FROM ai_knowledge_document WHERE source_kind IN (${currentSourceKinds}) AND organization_id IS NULL AND store_id IS NULL AND id NOT IN (${currentDocumentIds}));`,
      );
      statements.push(
        `UPDATE ai_knowledge_document SET index_status = 'stale', updated_at = ${now} WHERE source_kind IN (${currentSourceKinds}) AND organization_id IS NULL AND store_id IS NULL AND id NOT IN (${currentDocumentIds});`,
      );
    }
  }
  if (normalizedStaleScope.mode === 'source-root') {
    const sourceRootPredicate = buildSourceRootDocumentPredicate(normalizedStaleScope);
    const staleDocumentPredicate =
      documents.length > 0
        ? `${sourceRootPredicate} AND id NOT IN (${currentDocumentIds})`
        : sourceRootPredicate;
    statements.push(
      `UPDATE ai_knowledge_chunk SET vector_status = 'stale', indexed_at = ${now} WHERE document_id IN (SELECT id FROM ai_knowledge_document WHERE ${staleDocumentPredicate});`,
    );
    statements.push(
      `UPDATE ai_knowledge_document SET index_status = 'stale', updated_at = ${now} WHERE ${staleDocumentPredicate};`,
    );
  }
  statements.push(
    `UPDATE ai_knowledge_index_run SET status = 'succeeded', finished_at = ${now}, documents_indexed = ${documents.length}, chunks_upserted = ${chunks.length}, chunks_failed = 0, embedding_shape_json = ${sqlValue(JSON.stringify(embeddingShape))}, error_summary = NULL WHERE id = ${sqlValue(runId)};`,
  );
  return statements;
};

export const buildFailedSql = ({ runId, now, chunksFailed, error }) => [
  `UPDATE ai_knowledge_index_run SET status = 'failed', finished_at = ${now}, chunks_failed = ${chunksFailed}, error_summary = ${sqlValue(String(error).slice(0, 1000))} WHERE id = ${sqlValue(runId)};`,
];

export const buildVectorMetadata = (chunk) => ({
  visibility: chunk.visibility,
  internal_only: chunk.internalOnly,
  organization_id: chunk.organizationId ?? '',
  store_id: chunk.storeId ?? '',
  feature: chunk.feature ?? 'general',
  locale: chunk.locale,
  source_kind: chunk.sourceKind,
  source_path: chunk.sourcePath,
  tags_json: chunk.tagsJson ?? '[]',
});

export const buildDryRunResult = ({ documents }) => {
  const plan = createKnowledgeIndexingPlan({ documents });
  return {
    mode: 'dry-run',
    documentsSeen: plan.documents.length,
    chunksPrepared: plan.chunks.length,
    documents: plan.documents.map(({ content: _content, ...document }) => document),
  };
};

const isNumberArray = (value) =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

export const readEmbeddingVector = (payload) => {
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

export const readEmbeddingShape = (payload, vector) => {
  const value = payload?.result ?? payload;
  if (Array.isArray(value?.shape) && value.shape.every((entry) => typeof entry === 'number')) {
    return value.shape;
  }
  return [1, vector.length];
};

export const generateEmbeddingFromGateway = async ({
  accountId,
  gatewayId,
  token,
  model,
  text,
  fetchImpl = fetch,
}) => {
  const url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/${model}`;
  const response = await fetchImpl(url, {
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

export const runCommand = async (command, args, { cwd, env = process.env } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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

export const buildWranglerEnv = (env = process.env) => {
  const wranglerEnv = { ...env };
  if (!env.WRANGLER_CLOUDFLARE_API_TOKEN) {
    delete wranglerEnv.CLOUDFLARE_API_TOKEN;
  } else {
    wranglerEnv.CLOUDFLARE_API_TOKEN = env.WRANGLER_CLOUDFLARE_API_TOKEN;
  }
  delete wranglerEnv.CF_AI_GATEWAY_TOKEN;
  return wranglerEnv;
};

export const runWrangler = async (args, { backendRoot, env = process.env } = {}) =>
  runCommand('npx', ['wrangler', ...args], {
    cwd: backendRoot,
    env: buildWranglerEnv(env),
  });

export const readAccountId = async ({ repoRoot, env = process.env }) => {
  if (env.CLOUDFLARE_ACCOUNT_ID) {
    return env.CLOUDFLARE_ACCOUNT_ID;
  }
  if (env.CF_ACCOUNT_ID) {
    return env.CF_ACCOUNT_ID;
  }

  const accountCachePath = path.join(
    repoRoot,
    'node_modules/.cache/wrangler/wrangler-account.json',
  );
  const raw = await fs.readFile(accountCachePath, 'utf8');
  return JSON.parse(raw).account.id;
};

export const writeD1File = async (filePath, statements) => {
  await fs.writeFile(filePath, `${statements.join('\n')}\n`, 'utf8');
};

export const createDefaultKnowledgeIndexingDependencies = ({
  repoRoot,
  backendRoot,
  env = process.env,
}) => ({
  readAccountId: () => readAccountId({ repoRoot, env }),
  generateEmbedding: (input) => generateEmbeddingFromGateway(input),
  makeTempDir: () => fs.mkdtemp(path.join(os.tmpdir(), 'reserve-app-ai-index-')),
  writeD1File,
  executeD1File: (databaseName, filePath) =>
    runWrangler(['d1', 'execute', databaseName, '--remote', '--file', filePath, '--yes'], {
      backendRoot,
      env,
    }),
  writeVectorFile: (filePath, vectorLines) =>
    fs.writeFile(filePath, `${vectorLines.join('\n')}\n`, 'utf8'),
  upsertVectors: (vectorIndexName, vectorsPath) =>
    runWrangler(['vectorize', 'upsert', vectorIndexName, '--file', vectorsPath], {
      backendRoot,
      env,
    }),
  now: () => Date.now(),
  logProgress: (message) => console.error(message),
});

export const applyKnowledgeIndexing = async ({
  documents,
  repoRoot,
  backendRoot = path.join(repoRoot, 'apps/backend'),
  env = process.env,
  staleScope = 'full',
  dependencies,
}) => {
  const token = env.CF_AI_GATEWAY_TOKEN || env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error('Set CF_AI_GATEWAY_TOKEN to call Workers AI through AI Gateway.');
  }

  const resolvedDependencies = {
    ...createDefaultKnowledgeIndexingDependencies({ repoRoot, backendRoot, env }),
    ...dependencies,
  };

  const accountId = await resolvedDependencies.readAccountId();
  const gatewayId = env.AI_GATEWAY_ID || defaultGatewayId;
  const embeddingModel = env.AI_EMBEDDING_MODEL || defaultEmbeddingModel;
  const vectorIndexName = env.AI_KNOWLEDGE_INDEX_NAME || defaultVectorIndexName;
  const d1Database = env.AI_KNOWLEDGE_D1_DATABASE || defaultD1Database;
  const runId = `index-run:${resolvedDependencies.now()}`;
  const startedAt = resolvedDependencies.now();
  const tempDir = await resolvedDependencies.makeTempDir();
  const runStartSqlPath = path.join(tempDir, 'run-start.sql');
  const pendingSqlPath = path.join(tempDir, 'pending.sql');
  const successSqlPath = path.join(tempDir, 'success.sql');
  const failedSqlPath = path.join(tempDir, 'failed.sql');
  const vectorsPath = path.join(tempDir, 'vectors.ndjson');
  const plan = createKnowledgeIndexingPlan({ documents });

  await resolvedDependencies.writeD1File(
    runStartSqlPath,
    buildRunStartSql({
      runId,
      now: startedAt,
      documentsSeen: plan.documents.length,
      embeddingModel,
      vectorIndexName,
    }),
  );
  await resolvedDependencies.executeD1File(d1Database, runStartSqlPath);

  let embeddingShape = null;
  const vectorLines = [];
  try {
    for (const [index, chunk] of plan.chunks.entries()) {
      const embedding = await resolvedDependencies.generateEmbedding({
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
          metadata: buildVectorMetadata(chunk),
        }),
      );
      if ((index + 1) % 10 === 0 || index + 1 === plan.chunks.length) {
        resolvedDependencies.logProgress(
          `Generated embeddings: ${index + 1}/${plan.chunks.length}`,
        );
      }
    }

    await resolvedDependencies.writeVectorFile(vectorsPath, vectorLines);
    await resolvedDependencies.writeD1File(
      pendingSqlPath,
      buildPendingSql({
        documents: plan.documents,
        chunks: plan.chunks,
        now: resolvedDependencies.now(),
      }),
    );
    await resolvedDependencies.executeD1File(d1Database, pendingSqlPath);
    await resolvedDependencies.upsertVectors(vectorIndexName, vectorsPath);
    await resolvedDependencies.writeD1File(
      successSqlPath,
      buildSuccessSql({
        runId,
        documents: plan.documents,
        chunks: plan.chunks,
        now: resolvedDependencies.now(),
        embeddingShape,
        staleScope,
      }),
    );
    await resolvedDependencies.executeD1File(d1Database, successSqlPath);
  } catch (error) {
    await resolvedDependencies.writeD1File(
      failedSqlPath,
      buildFailedSql({
        runId,
        now: resolvedDependencies.now(),
        chunksFailed: plan.chunks.length,
        error,
      }),
    );
    await resolvedDependencies.executeD1File(d1Database, failedSqlPath).catch(() => {});
    throw error;
  }

  return {
    mode: 'apply',
    accountId,
    gatewayId,
    vectorIndexName,
    d1Database,
    runId,
    documentsIndexed: plan.documents.length,
    chunksUpserted: plan.chunks.length,
    embeddingModel,
    embeddingShape,
    tempDir,
  };
};

export const runKnowledgeIndexing = async ({
  documents,
  apply = false,
  repoRoot,
  backendRoot,
  env = process.env,
  staleScope = 'full',
  dependencies,
}) => {
  if (!apply) {
    return buildDryRunResult({ documents });
  }

  return applyKnowledgeIndexing({
    documents,
    repoRoot,
    backendRoot,
    env,
    staleScope,
    dependencies,
  });
};
