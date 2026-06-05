import type { TestInfo } from '@playwright/test';

/** E2E が接続する backend API の base URL。 */
export const backendUrl = process.env.PUBLIC_BACKEND_URL?.trim() || 'http://localhost:3000';

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
