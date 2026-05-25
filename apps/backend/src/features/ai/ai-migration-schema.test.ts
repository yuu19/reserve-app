import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(currentDir, '../../..');
const migrationDir = path.join(backendRoot, 'drizzle');

describe('AI migration schema', () => {
  it('keeps the rebuilt AI schema in 0018 without a dependent 0019 migration', async () => {
    const [migrationSql, migrationFiles] = await Promise.all([
      fs.readFile(path.join(migrationDir, '0018_ai_chatbot.sql'), 'utf8'),
      fs.readdir(migrationDir),
    ]);

    expect(migrationFiles).not.toContain('0019_ai_message_observability.sql');
    expect(migrationSql).toContain('CREATE TABLE `ai_conversation`');
    expect(migrationSql).toContain('`actor_user_id` text NOT NULL');
    expect(migrationSql).toContain('`subject_type` text NOT NULL');
    expect(migrationSql).toContain('`subject_id` text NOT NULL');
    expect(migrationSql).toContain('`channel` text DEFAULT');
    expect(migrationSql).toContain('`status` text DEFAULT');
    expect(migrationSql).toContain('`last_message_at` integer');
    expect(migrationSql).toContain('CREATE TABLE `ai_usage_event`');
    expect(migrationSql).toContain('`provider` text');
    expect(migrationSql).toContain('`model` text');
    expect(migrationSql).toContain('`input_tokens` integer');
    expect(migrationSql).toContain('`output_tokens` integer');
    expect(migrationSql).toContain('`generation_status` text');
    expect(migrationSql).not.toContain('`ai_model`');
    expect(migrationSql).not.toContain('`ai_latency_ms`');
  });
});
