import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chunkKnowledgeContent, discoverMarkdownKnowledge } from './indexer.js';

const tempDirs: string[] = [];

const createTempDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reserve-app-ai-indexer-'));
  tempDirs.push(dir);
  return dir;
};

describe('AI knowledge indexer', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it('chunks long knowledge content with overlap and ignores empty content', () => {
    expect(chunkKnowledgeContent({ content: '   \n\n ' })).toEqual([]);

    const chunks = chunkKnowledgeContent({
      content: '0123456789abcdefghij',
      targetSize: 10,
      overlap: 3,
    });

    expect(chunks).toEqual(['0123456789', '789abcdefg', 'efghij']);
  });

  it('discovers markdown/spec documents with frontmatter metadata and titles', async () => {
    const rootDir = await createTempDir();
    await fs.mkdir(path.join(rootDir, 'nested'));
    await fs.writeFile(
      path.join(rootDir, 'manual.md'),
      [
        '---',
        'title: "予約FAQ"',
        'locale: ja',
        'feature: booking',
        '---',
        '',
        '# 見出し',
        '本文',
      ].join('\n'),
    );
    await fs.writeFile(path.join(rootDir, 'nested', 'ignored.txt'), 'ignored');

    const documents = await discoverMarkdownKnowledge({
      rootDir,
      sourceKind: 'docs',
      visibility: 'authenticated',
      internalOnly: false,
    });

    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      sourceKind: 'docs',
      title: '予約FAQ',
      locale: 'ja',
      visibility: 'authenticated',
      internalOnly: false,
      feature: 'booking',
    });
    expect(documents[0]?.sourcePath).toContain('manual.md');
    expect(documents[0]?.content).toContain('# 見出し');
  });
});
