import { authRpc, type AuthSessionPayload } from '$lib/rpc-client';

export type JsonRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

export const asSessionPayload = (value: unknown): AuthSessionPayload => {
	if (value === null) {
		return null;
	}
	if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.session)) {
		return null;
	}
	return { user: value.user, session: value.session };
};

export const parseResponseBody = async (response: Response): Promise<unknown> => {
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

export const toErrorMessage = (payload: unknown, fallback: string): string => {
	if (isRecord(payload) && typeof payload.message === 'string') {
		return payload.message;
	}
	if (isRecord(payload) && typeof payload.error === 'string') {
		return payload.error;
	}
	if (typeof payload === 'string' && payload.length > 0) {
		return payload;
	}
	return fallback;
};

export const getNextPathFromSearch = (): string | null => {
	if (typeof window === 'undefined') {
		return null;
	}
	const searchParams = new URLSearchParams(window.location.search);
	const next = searchParams.get('next');
	if (!next || !next.startsWith('/')) {
		return null;
	}
	return next;
};

export const navigateToNextIfNeeded = (): boolean => {
	if (typeof window === 'undefined') {
		return false;
	}
	const next = getNextPathFromSearch();
	if (!next) {
		return false;
	}
	const url = new URL(next, 'http://localhost');
	window.location.assign(`${url.pathname}${url.search}${url.hash}`);
	return true;
};

export const redirectToLoginWithNext = (nextPath: string) => {
	if (typeof window === 'undefined') {
		return;
	}
	window.location.assign(`/?next=${encodeURIComponent(nextPath)}`);
};

export const getCurrentPathWithSearch = (): string => {
	if (typeof window === 'undefined') {
		return '/';
	}
	return `${window.location.pathname}${window.location.search}${window.location.hash}`;
};

export const loadSession = async (): Promise<{ session: AuthSessionPayload; status: number }> => {
	const response = await authRpc.getSession();
	const payload = await parseResponseBody(response);
	if (!response.ok) {
		return { session: null, status: response.status };
	}
	return { session: asSessionPayload(payload), status: response.status };
};
