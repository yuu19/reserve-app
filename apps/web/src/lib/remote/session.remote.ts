import { env } from '$env/dynamic/public';
import { getRequestEvent, query } from '$app/server';
import type { AuthSessionPayload } from '$lib/rpc-client';

const defaultBackendUrl = 'http://localhost:3000';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const asSessionPayload = (value: unknown): AuthSessionPayload => {
	if (value === null) {
		return null;
	}
	if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.session)) {
		return null;
	}
	return { user: value.user, session: value.session };
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
	const contentType = response.headers.get('content-type') ?? '';
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

const createSessionUrl = (): string => {
	const backendUrl = env.PUBLIC_BACKEND_URL || defaultBackendUrl;
	return new URL('/api/v1/auth/session', backendUrl).toString();
};

type RemoteSessionResult = {
	session: AuthSessionPayload;
	status: number;
};

export const getRemoteSession = query(async (): Promise<RemoteSessionResult> => {
	const event = getRequestEvent();
	const headers = new Headers();
	const cookie = event.request.headers.get('cookie');
	if (cookie) {
		headers.set('cookie', cookie);
	}
	const userAgent = event.request.headers.get('user-agent');
	if (userAgent) {
		headers.set('user-agent', userAgent);
	}

	try {
		const response = await event.fetch(createSessionUrl(), {
			method: 'GET',
			headers
		});
		const payload = await parseResponseBody(response);
		if (!response.ok) {
			return {
				session: null,
				status: response.status
			};
		}
		return {
			session: asSessionPayload(payload),
			status: response.status
		};
	} catch {
		return {
			session: null,
			status: 503
		};
	}
});
