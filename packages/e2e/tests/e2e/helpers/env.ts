import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestInfo } from '@playwright/test';

const readGeneratedEnv = (): Record<string, string> => {
  const envFile = path.join(os.tmpdir(), 'reserve-app-web-e2e-env.json');
  try {
    const payload = JSON.parse(fs.readFileSync(envFile, 'utf8')) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(payload).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
};

const generatedEnv = readGeneratedEnv();

/** E2E が接続する backend API の base URL。 */
export const backendUrl = process.env.PUBLIC_BACKEND_URL?.trim() || 'http://localhost:3000';
/**
 * Public events smoke test で既定値として使う organization slug。
 *
 * Playwright global setup が生成した temporary env file を環境変数の fallback として読む。
 */
export const publicEventsOrgSlug =
  process.env.PUBLIC_EVENTS_ORG_SLUG?.trim() ||
  generatedEnv.PUBLIC_EVENTS_ORG_SLUG?.trim() ||
  'public-events';
/**
 * Public events smoke test で既定値として使う store slug。
 *
 * 未指定時は organization slug と同じ slug を使う。
 */
export const publicEventsStoreSlug =
  process.env.PUBLIC_EVENTS_STORE_SLUG?.trim() ||
  generatedEnv.PUBLIC_EVENTS_STORE_SLUG?.trim() ||
  publicEventsOrgSlug;

const sanitizeToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 34)
    .replace(/^-+|-+$/g, '') || 'e2e';

/**
 * Test title と worker index から backend fixture 用の短い一意 token を作る。
 *
 * @param testInfo - Playwright が各 test に渡す metadata。
 * @param prefix - fixture の種類を識別する prefix。
 * @returns URL slug や email local part に使える ASCII token。
 */
export const uniqueToken = (testInfo: TestInfo, prefix: string): string => {
  const title = sanitizeToken(testInfo.title);
  return sanitizeToken(`${prefix}-${testInfo.workerIndex}-${Date.now()}-${title}`);
};
