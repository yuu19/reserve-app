import { env } from '$env/dynamic/public';
import { getRequestEvent, query } from '$app/server';
import type {
	PublicBookingPagePayload,
	PublicSitePagePayload,
	PublicSiteProfilePayload,
	PublicTicketTypePayload
} from '$lib/rpc-client';
import { z } from 'zod';

const defaultBackendUrl = 'http://localhost:3000';

type JsonRecord = Record<string, unknown>;

const publicSiteQuerySchema = z.object({
	orgSlug: z.string().trim().min(1),
	classroomSlug: z.string().trim().min(1)
});

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

const toErrorMessage = (payload: unknown, fallback: string): string => {
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

const createApiUrl = (path: string): string => {
	const backendUrl = env.PUBLIC_BACKEND_URL || defaultBackendUrl;
	return new URL(path, backendUrl).toString();
};

const publicSitePath = ({
	orgSlug,
	classroomSlug
}: {
	orgSlug: string;
	classroomSlug: string;
}): string =>
	`/api/v1/public/orgs/${encodeURIComponent(orgSlug)}/classrooms/${encodeURIComponent(
		classroomSlug
	)}/site`;

const isPublicSiteProfile = (value: unknown): value is PublicSiteProfilePayload =>
	isRecord(value) &&
	typeof value.organizationId === 'string' &&
	typeof value.organizationSlug === 'string' &&
	typeof value.organizationName === 'string' &&
	typeof value.classroomId === 'string' &&
	typeof value.classroomSlug === 'string' &&
	typeof value.classroomName === 'string' &&
	typeof value.siteName === 'string';

const isPublicTicketType = (value: unknown): value is PublicTicketTypePayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.name === 'string' &&
	typeof value.totalCount === 'number' &&
	(value.expiresInDays === undefined ||
		value.expiresInDays === null ||
		typeof value.expiresInDays === 'number') &&
	(value.serviceScope === 'all' || value.serviceScope === 'specific') &&
	Array.isArray(value.serviceIds) &&
	value.serviceIds.every((serviceId) => typeof serviceId === 'string') &&
	Array.isArray(value.serviceNames) &&
	value.serviceNames.every((serviceName) => typeof serviceName === 'string');

const isPublicBookingPage = (value: unknown): value is PublicBookingPagePayload =>
	isRecord(value) &&
	value.kind === 'event' &&
	typeof value.id === 'string' &&
	typeof value.title === 'string' &&
	typeof value.href === 'string' &&
	typeof value.serviceId === 'string' &&
	typeof value.slotId === 'string' &&
	typeof value.startAt === 'string' &&
	typeof value.endAt === 'string' &&
	typeof value.remainingCount === 'number' &&
	typeof value.capacity === 'number' &&
	typeof value.isBookable === 'boolean';

const asPublicTicketTypes = (value: unknown): PublicTicketTypePayload[] =>
	Array.isArray(value) ? value.filter(isPublicTicketType) : [];

const asPublicBookingPages = (value: unknown): PublicBookingPagePayload[] =>
	Array.isArray(value) ? value.filter(isPublicBookingPage) : [];

const asPublicSitePage = (value: unknown): PublicSitePagePayload | null => {
	if (!isRecord(value) || !isPublicSiteProfile(value.site)) {
		return null;
	}
	return {
		site: value.site,
		bookingPages: asPublicBookingPages(value.bookingPages),
		ticketTypes: asPublicTicketTypes(value.ticketTypes)
	};
};

export const getPublicSitePage = query(
	publicSiteQuerySchema,
	async ({ orgSlug, classroomSlug }): Promise<PublicSitePagePayload> => {
		const event = getRequestEvent();
		const response = await event.fetch(createApiUrl(publicSitePath({ orgSlug, classroomSlug })), {
			method: 'GET'
		});
		const payload = await parseResponseBody(response);
		if (!response.ok) {
			throw new Error(toErrorMessage(payload, '予約サイトの取得に失敗しました。'));
		}
		const publicSitePage = asPublicSitePage(payload);
		if (!publicSitePage) {
			throw new Error('予約サイトの形式が不正です。');
		}
		return publicSitePage;
	}
);
