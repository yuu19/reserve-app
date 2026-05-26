#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertKnownKnowledgeSourceRootId,
  createDefaultKnowledgeSourceRoots,
  defaultKnowledgeSourceRootIds,
  discoverKnowledgeDocuments,
  KnowledgeSourceNotFoundError,
  KnowledgeSourceUsageError,
  normalizeRepoRelativePath,
  selectKnowledgeSourceRoots,
} from './ai-knowledge-source-loader.mjs';
import { runKnowledgeIndexing } from './ai-knowledge-indexing-usecase.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const backendRoot = path.join(repoRoot, 'apps/backend');

class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliUsageError';
  }
}

const usage = [
  'Usage: node scripts/index-ai-knowledge.mjs [--dry-run | --apply] [--source-root <app-docs|internal-docs|specs>] [--source-path <repo-relative-path>]',
  '',
  'Options:',
  '  --dry-run                  Discover and plan indexing without writing to D1, Vectorize, or Workers AI.',
  '  --apply                    Write remote D1 rows and upsert vectors. Requires CF_AI_GATEWAY_TOKEN.',
  `  --source-root <root>       Index only one knowledge root: ${defaultKnowledgeSourceRootIds.join(', ')}.`,
  '  --source-path <path>       Index only the matching repository-relative knowledge source.',
].join('\n');

export const parseArgs = (argv) => {
  const options = {
    apply: false,
    dryRun: false,
    sourceRoot: null,
    sourcePath: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--source-root': {
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
          throw new CliUsageError(
            `--source-root requires one of: ${defaultKnowledgeSourceRootIds.join(', ')}.`,
          );
        }
        options.sourceRoot = assertKnownKnowledgeSourceRootId(value);
        index += 1;
        break;
      }
      case '--source-path': {
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
          throw new CliUsageError('--source-path requires a repo-relative path.');
        }
        options.sourcePath = normalizeRepoRelativePath(value);
        index += 1;
        break;
      }
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new CliUsageError(`Unknown option: ${arg}`);
    }
  }

  if (options.apply && options.dryRun) {
    throw new CliUsageError('Use either --dry-run or --apply, not both.');
  }

  return {
    ...options,
    dryRun: !options.apply,
  };
};

const createStaleScope = ({ sourceRoot, sourcePath, roots }) => {
  if (sourcePath) {
    return 'targeted';
  }
  if (sourceRoot) {
    const [root] = roots;
    return {
      mode: 'source-root',
      sourceKind: root.sourceKind,
      sourcePathPrefix: root.repoRelativePrefix,
    };
  }
  return 'full';
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }

  const roots = selectKnowledgeSourceRoots({
    roots: createDefaultKnowledgeSourceRoots({ repoRoot }),
    sourceRoot: options.sourceRoot,
  });
  const documents = await discoverKnowledgeDocuments({
    repoRoot,
    roots,
    sourcePath: options.sourcePath,
  });
  const result = await runKnowledgeIndexing({
    documents,
    apply: options.apply,
    repoRoot,
    backendRoot,
    env: process.env,
    staleScope: createStaleScope({
      sourceRoot: options.sourceRoot,
      sourcePath: options.sourcePath,
      roots,
    }),
  });

  const message = options.apply
    ? 'Knowledge indexing completed.'
    : 'Knowledge discovery completed. Re-run with --apply and CF_AI_GATEWAY_TOKEN to upsert these sources into production D1 and Vectorize.';

  console.log(
    JSON.stringify(
      {
        message,
        sourceRoot: options.sourceRoot,
        sourcePath: options.sourcePath,
        ...result,
      },
      null,
      2,
    ),
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    if (
      error instanceof CliUsageError ||
      error instanceof KnowledgeSourceUsageError ||
      error instanceof KnowledgeSourceNotFoundError
    ) {
      console.error(error.message);
      console.error('');
      console.error(usage);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}
