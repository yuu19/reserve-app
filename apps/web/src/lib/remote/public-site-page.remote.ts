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
	storeSlug: z.string().trim().min(1)
});

const publicTicketTypeQuerySchema = publicSiteQuerySchema.extend({
	ticketTypeId: z.string().trim().min(1)
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

const publicSitePath = ({ orgSlug, storeSlug }: { orgSlug: string; storeSlug: string }): string =>
	`/api/v1/public/orgs/${encodeURIComponent(orgSlug)}/stores/${encodeURIComponent(storeSlug)}/site`;

const publicTicketTypePath = ({
	orgSlug,
	storeSlug,
	ticketTypeId
}: {
	orgSlug: string;
	storeSlug: string;
	ticketTypeId: string;
}): string =>
	`/api/v1/public/orgs/${encodeURIComponent(orgSlug)}/stores/${encodeURIComponent(
		storeSlug
	)}/ticket-types/${encodeURIComponent(ticketTypeId)}`;

const isPublicSiteProfile = (value: unknown): value is PublicSiteProfilePayload =>
	isRecord(value) &&
	typeof value.organizationId === 'string' &&
	typeof value.organizationSlug === 'string' &&
	typeof value.organizationName === 'string' &&
	typeof value.storeId === 'string' &&
	typeof value.storeSlug === 'string' &&
	typeof value.storeName === 'string' &&
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
	value.serviceNames.every((serviceName) => typeof serviceName === 'string') &&
	typeof value.href === 'string';

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
	async ({ orgSlug, storeSlug }): Promise<PublicSitePagePayload> => {
		const event = getRequestEvent();
		const response = await event.fetch(createApiUrl(publicSitePath({ orgSlug, storeSlug })), {
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

export const getPublicTicketType = query(
	publicTicketTypeQuerySchema,
	async ({ orgSlug, storeSlug, ticketTypeId }): Promise<PublicTicketTypePayload> => {
		const event = getRequestEvent();
		const response = await event.fetch(
			createApiUrl(publicTicketTypePath({ orgSlug, storeSlug, ticketTypeId })),
			{
				method: 'GET'
			}
		);
		const payload = await parseResponseBody(response);
		if (!response.ok) {
			throw new Error(toErrorMessage(payload, '回数券詳細の取得に失敗しました。'));
		}
		if (!isPublicTicketType(payload)) {
			throw new Error('回数券詳細の形式が不正です。');
		}
		return payload;
	}
);
