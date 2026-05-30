import type { APIResponse } from '@playwright/test';
import { expect } from '@playwright/test';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

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

export const expectOkJson = async <T extends JsonRecord>(
	response: APIResponse,
	message: string
): Promise<T> => {
	const payload = await parseResponseBody(response);
	expect(response.ok(), `${message}: ${response.status()} ${JSON.stringify(payload)}`).toBe(true);
	expect(isRecord(payload), `${message}: response should be an object`).toBe(true);
	return payload as T;
};
