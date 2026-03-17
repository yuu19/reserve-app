import { env } from '$env/dynamic/public';
import { getRequestEvent } from '$app/server';
import type { AccessEffectivePayload, ScopedApiContext } from '$lib/rpc-client';

const defaultBackendUrl = 'http://localhost:3000';

export type QueryValue = string | number | boolean | undefined;

export type ApiResult = {
	response: Response;
	payload: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isAccessEffectivePayload = (value: unknown): value is AccessEffectivePayload =>
	isRecord(value) &&
	typeof value.canManageOrganization === 'boolean' &&
	typeof value.canManageClassroom === 'boolean' &&
	typeof value.canManageBookings === 'boolean' &&
	typeof value.canManageParticipants === 'boolean' &&
	typeof value.canUseParticipantBooking === 'boolean';

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

const createApiUrl = (path: string, query: Record<string, QueryValue> = {}): string => {
	const backendUrl = env.PUBLIC_BACKEND_URL || defaultBackendUrl;
	const url = new URL(path, backendUrl);
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined) {
			continue;
		}
		url.searchParams.set(key, String(value));
	}
	return url.toString();
};

const createForwardHeaders = () => {
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
	return headers;
};

export const createApiGetter = () => {
	const event = getRequestEvent();
	const headers = createForwardHeaders();
	return async (path: string, query?: Record<string, QueryValue>): Promise<ApiResult> => {
		const response = await event.fetch(createApiUrl(path, query), {
			method: 'GET',
			headers
		});
		const payload = await parseResponseBody(response);
		return { response, payload };
	};
};

export type ScopedApiIdentifiers = {
	organizationId: string;
	classroomId: string;
};

export type ScopedAccessContext = ScopedApiIdentifiers & {
	activeContext: ScopedApiContext;
	effective: AccessEffectivePayload;
};

export const buildScopedInvitationPath = (context: ScopedApiContext) =>
	`/api/v1/auth/orgs/${encodeURIComponent(context.orgSlug)}/classrooms/${encodeURIComponent(context.classroomSlug)}/invitations`;

export const resolveScopedApiIdentifiers = async (
	getApi: ReturnType<typeof createApiGetter>,
	context: ScopedApiContext
): Promise<ScopedApiIdentifiers | null> => {
	const scopedAccess = await resolveScopedAccessContext(getApi, context);
	if (!scopedAccess) {
		return null;
	}
	return {
		organizationId: scopedAccess.organizationId,
		classroomId: scopedAccess.classroomId
	};
};

export const resolveScopedAccessContext = async (
	getApi: ReturnType<typeof createApiGetter>,
	context: ScopedApiContext
): Promise<ScopedAccessContext | null> => {
	const accessTreeResult = await getApi('/api/v1/auth/orgs/access-tree');
	if (!accessTreeResult.response.ok || !isRecord(accessTreeResult.payload)) {
		return null;
	}

	const orgs = accessTreeResult.payload.orgs;
	if (!Array.isArray(orgs)) {
		return null;
	}

	let organizationId: string | null = null;

	for (const orgEntry of orgs) {
		if (!isRecord(orgEntry) || !isRecord(orgEntry.org) || !Array.isArray(orgEntry.classrooms)) {
			continue;
		}
		if (orgEntry.org.slug !== context.orgSlug || typeof orgEntry.org.id !== 'string') {
			continue;
		}
		organizationId = orgEntry.org.id;
		for (const classroom of orgEntry.classrooms) {
			if (
				isRecord(classroom) &&
				classroom.slug === context.classroomSlug &&
				typeof classroom.id === 'string' &&
				isAccessEffectivePayload(classroom.effective)
			) {
				return {
					organizationId: orgEntry.org.id,
					classroomId: classroom.id,
					activeContext: context,
					effective: classroom.effective
				};
			}
		}
	}

	if (!organizationId) {
		return null;
	}

	const classroomsResult = await getApi(
		`/api/v1/auth/orgs/${encodeURIComponent(context.orgSlug)}/classrooms`
	);
	if (!classroomsResult.response.ok || !Array.isArray(classroomsResult.payload)) {
		return null;
	}

	for (const classroom of classroomsResult.payload) {
		if (
			isRecord(classroom) &&
			classroom.slug === context.classroomSlug &&
			typeof classroom.id === 'string' &&
			isAccessEffectivePayload(classroom.effective)
		) {
			return {
				organizationId,
				classroomId: classroom.id,
				activeContext: context,
				effective: classroom.effective
			};
		}
	}

	return null;
};
