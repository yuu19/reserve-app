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
				(entry): entry is [string, string] => typeof entry[1] === 'string'
			)
		);
	} catch {
		return {};
	}
};

const generatedEnv = readGeneratedEnv();

export const backendUrl = process.env.PUBLIC_BACKEND_URL?.trim() || 'http://localhost:3000';
export const publicEventsOrgSlug =
	process.env.PUBLIC_EVENTS_ORG_SLUG?.trim() ||
	generatedEnv.PUBLIC_EVENTS_ORG_SLUG?.trim() ||
	'public-events';
export const publicEventsClassroomSlug =
	process.env.PUBLIC_EVENTS_CLASSROOM_SLUG?.trim() ||
	generatedEnv.PUBLIC_EVENTS_CLASSROOM_SLUG?.trim() ||
	publicEventsOrgSlug;

const sanitizeToken = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 34)
		.replace(/^-+|-+$/g, '') || 'e2e';

export const uniqueToken = (testInfo: TestInfo, prefix: string): string => {
	const title = sanitizeToken(testInfo.title);
	return sanitizeToken(`${prefix}-${testInfo.workerIndex}-${Date.now()}-${title}`);
};
