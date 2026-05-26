import fs from 'node:fs/promises';
import path from 'node:path';

export class KnowledgeSourceUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KnowledgeSourceUsageError';
  }
}

export class KnowledgeSourceNotFoundError extends Error {
  constructor(sourcePath) {
    super(`No knowledge source matched --source-path ${sourcePath}`);
    this.name = 'KnowledgeSourceNotFoundError';
    this.sourcePath = sourcePath;
  }
}

export const defaultKnowledgeSourceRootIds = Object.freeze(['app-docs', 'internal-docs', 'specs']);

const markdownFilePattern = /\.(md|mdx|svx|svelte\.md)$/u;
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

export const normalizeKnowledgeSourceRootId = (value) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new KnowledgeSourceUsageError(
      `--source-root requires one of: ${defaultKnowledgeSourceRootIds.join(', ')}.`,
    );
  }

  return value.trim();
};

export const assertKnownKnowledgeSourceRootId = (
  value,
  knownRootIds = defaultKnowledgeSourceRootIds,
) => {
  const normalized = normalizeKnowledgeSourceRootId(value);
  if (!knownRootIds.includes(normalized)) {
    throw new KnowledgeSourceUsageError(
      `Unknown --source-root ${normalized}. Expected one of: ${knownRootIds.join(', ')}.`,
    );
  }
  return normalized;
};

const createKnowledgeSourceRoot = ({
  repoRoot,
  id,
  repoRelativePrefix,
  sourceKind,
  visibility,
  internalOnly,
}) => ({
  id,
  repoRelativePrefix,
  sourceKind,
  rootDir: path.join(repoRoot, repoRelativePrefix),
  visibility,
  internalOnly,
});

export const createDefaultKnowledgeSourceRoots = ({ repoRoot }) => [
  createKnowledgeSourceRoot({
    repoRoot,
    id: 'app-docs',
    repoRelativePrefix: 'apps/docs',
    sourceKind: 'docs',
    visibility: 'authenticated',
    internalOnly: false,
  }),
  createKnowledgeSourceRoot({
    repoRoot,
    id: 'internal-docs',
    repoRelativePrefix: 'docs',
    sourceKind: 'docs',
    visibility: 'admin',
    internalOnly: true,
  }),
  createKnowledgeSourceRoot({
    repoRoot,
    id: 'specs',
    repoRelativePrefix: 'specs',
    sourceKind: 'specs',
    visibility: 'admin',
    internalOnly: true,
  }),
];

export const normalizeRepoRelativePath = (value) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new KnowledgeSourceUsageError('--source-path requires a repo-relative path.');
  }

  const rawPath = value.trim().replace(/\\/g, '/');
  if (path.isAbsolute(rawPath)) {
    throw new KnowledgeSourceUsageError('--source-path must be repo-relative, not absolute.');
  }

  const normalized = path.posix.normalize(rawPath.replace(/^\.\//u, ''));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new KnowledgeSourceUsageError('--source-path must stay inside the repository.');
  }

  return normalized;
};

export const repoRelativePathMatchesPrefix = ({ sourcePath, repoRelativePrefix }) => {
  const normalizedSourcePath = normalizeRepoRelativePath(sourcePath);
  const normalizedPrefix = normalizeRepoRelativePath(repoRelativePrefix);
  return (
    normalizedSourcePath === normalizedPrefix ||
    normalizedSourcePath.startsWith(`${normalizedPrefix}/`)
  );
};

export const selectKnowledgeSourceRoots = ({ roots, sourceRoot }) => {
  if (!sourceRoot) {
    return roots;
  }

  const knownRootIds = roots.map((root) => root.id).filter(Boolean);
  const normalizedSourceRoot = assertKnownKnowledgeSourceRootId(
    sourceRoot,
    knownRootIds.length > 0 ? knownRootIds : defaultKnowledgeSourceRootIds,
  );
  return roots.filter((root) => root.id === normalizedSourceRoot);
};

const toRepoRelativePath = ({ repoRoot, filePath }) =>
  path.relative(repoRoot, filePath).split(path.sep).join('/');

export const stripFrontmatter = (content) => {
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

export const chunkKnowledgeContent = ({ content, targetSize = 800, overlap = 100 }) => {
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

const parseTags = (value) => {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((entry) => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
    } catch {
      // Fall back to comma-separated parsing below.
    }
  }

  return trimmed
    .split(',')
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
};

const inferTitle = ({ frontmatter, body, filePath }) =>
  frontmatter.title ||
  body.match(/^#\s+(.+)$/mu)?.[1]?.trim() ||
  path.basename(filePath).replace(markdownFilePattern, '');

export const walkMarkdownFiles = async (dir) => {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }
      files.push(...(await walkMarkdownFiles(fullPath)));
      continue;
    }
    if (markdownFilePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
};

export const loadMarkdownKnowledgeDocument = async ({ repoRoot, filePath, root }) => {
  const raw = await fs.readFile(filePath, 'utf8');
  const { frontmatter, body } = stripFrontmatter(raw);

  return {
    sourceKind: root.sourceKind,
    sourcePath: toRepoRelativePath({ repoRoot, filePath }),
    title: inferTitle({ frontmatter, body, filePath }),
    content: body,
    locale: frontmatter.locale === 'en' ? 'en' : 'ja',
    visibility: root.visibility,
    internalOnly: Boolean(root.internalOnly),
    organizationId: null,
    classroomId: null,
    feature: frontmatter.feature || null,
    tags: parseTags(frontmatter.tags),
  };
};

export const discoverMarkdownKnowledge = async ({
  repoRoot = process.cwd(),
  rootDir,
  sourceKind,
  visibility,
  internalOnly = false,
}) => {
  const root = { sourceKind, rootDir, visibility, internalOnly };
  const files = await walkMarkdownFiles(rootDir);
  const documents = await Promise.all(
    files.map((filePath) => loadMarkdownKnowledgeDocument({ repoRoot, filePath, root })),
  );

  return documents.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
};

export const discoverKnowledgeDocuments = async ({
  repoRoot,
  roots = createDefaultKnowledgeSourceRoots({ repoRoot }),
  sourceRoot,
  sourcePath,
}) => {
  const normalizedSourcePath = sourcePath ? normalizeRepoRelativePath(sourcePath) : null;
  const selectedRoots = selectKnowledgeSourceRoots({ roots, sourceRoot });
  const discovered = [];

  for (const root of selectedRoots) {
    if (
      normalizedSourcePath &&
      root.repoRelativePrefix &&
      !repoRelativePathMatchesPrefix({
        sourcePath: normalizedSourcePath,
        repoRelativePrefix: root.repoRelativePrefix,
      })
    ) {
      continue;
    }

    const files = await walkMarkdownFiles(root.rootDir);
    for (const filePath of files) {
      const repoRelativePath = toRepoRelativePath({ repoRoot, filePath });
      if (normalizedSourcePath && repoRelativePath !== normalizedSourcePath) {
        continue;
      }

      discovered.push(await loadMarkdownKnowledgeDocument({ repoRoot, filePath, root }));
    }
  }

  discovered.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  if (normalizedSourcePath && discovered.length === 0) {
    throw new KnowledgeSourceNotFoundError(normalizedSourcePath);
  }

  return discovered;
};
