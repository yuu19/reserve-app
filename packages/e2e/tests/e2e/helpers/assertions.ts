import type { APIResponse } from '@playwright/test';
import { expect } from '@playwright/test';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null;

/**
 * API response body を assertion message に使いやすい形へ変換する。
 *
 * JSON response は parsed value、空 body は `null`、JSON ではない body は text を返す。
 *
 * @param response - 読み取る Playwright API response。
 * @returns Parsed JSON、text body、または空 body を表す `null`。
 */
export const parseResponseBody = async (response: APIResponse) => {
  const contentType = response.headers()['content-type'] ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * API response が success status かつ JSON object であることを検証する。
 *
 * 失敗時には status code と response body を含む Playwright assertion message を出す。
 *
 * @template T - 呼び出し側が期待する JSON object payload。
 * @param response - 検証する Playwright API response。
 * @param message - assertion failure の文脈を示す説明。
 * @returns `T` として扱える JSON object payload。
 */
export const expectOkJson = async <T extends JsonRecord>(
  response: APIResponse,
  message: string,
): Promise<T> => {
  const payload = await parseResponseBody(response);
  expect(response.ok(), `${message}: ${response.status()} ${JSON.stringify(payload)}`).toBe(true);
  expect(isRecord(payload), `${message}: response should be an object`).toBe(true);
  return payload as T;
};
