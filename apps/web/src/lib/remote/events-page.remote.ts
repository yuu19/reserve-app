import { env } from '$env/dynamic/public';
import { getRequestEvent, query } from '$app/server';
import type {
	PublicEventDetailPayload,
	PublicEventListItemPayload,
	PublicEventsPagePayload,
	PublicSiteIntakeFieldPayload,
	PublicTicketTypePayload
} from '$lib/rpc-client';
import { z } from 'zod';

const defaultBackendUrl = 'http://localhost:3000';

type JsonRecord = Record<string, unknown>;

const publicEventDetailQuerySchema = z.object({
	slotId: z.string().trim().min(1),
	orgSlug: z.string().trim().min(1).optional(),
	storeSlug: z.string().trim().min(1).optional()
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

type PublicEventsContextInput = {
	orgSlug?: string;
	storeSlug?: string;
};

const publicEventsQuerySchema = z
	.object({
		orgSlug: z.string().trim().min(1).optional(),
		storeSlug: z.string().trim().min(1).optional()
	})
	.optional();

const resolvePublicEventsContext = (input?: PublicEventsContextInput) => {
	const scopedOrgSlug = input?.orgSlug?.trim();
	const scopedStoreSlug = input?.storeSlug?.trim();
	const orgSlug = scopedOrgSlug || env.PUBLIC_EVENTS_ORG_SLUG || 'public-events';
	const storeSlug = scopedStoreSlug || env.PUBLIC_EVENTS_STORE_SLUG || orgSlug;
	return { orgSlug, storeSlug };
};

const publicEventsPath = (context: PublicEventsContextInput, suffix = ''): string => {
	const { orgSlug, storeSlug } = resolvePublicEventsContext(context);
	return `/api/v1/public/orgs/${encodeURIComponent(orgSlug)}/stores/${encodeURIComponent(
		storeSlug
	)}/events${suffix}`;
};

const isPublicEvent = (value: unknown): value is PublicEventListItemPayload =>
	isRecord(value) &&
	typeof value.organizationId === 'string' &&
	typeof value.organizationSlug === 'string' &&
	typeof value.storeId === 'string' &&
	typeof value.storeSlug === 'string' &&
	typeof value.serviceId === 'string' &&
	typeof value.serviceName === 'string' &&
	typeof value.slotId === 'string' &&
	typeof value.startAt === 'string' &&
	typeof value.endAt === 'string' &&
	typeof value.slotStatus === 'string' &&
	typeof value.capacity === 'number' &&
	typeof value.reservedCount === 'number' &&
	typeof value.remainingCount === 'number' &&
	typeof value.bookingOpenAt === 'string' &&
	typeof value.bookingCloseAt === 'string' &&
	typeof value.isBookable === 'boolean';

const asPublicEvents = (value: unknown): PublicEventListItemPayload[] =>
	Array.isArray(value) ? value.filter(isPublicEvent) : [];

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

const asPublicTicketTypes = (value: unknown): PublicTicketTypePayload[] =>
	Array.isArray(value) ? value.filter(isPublicTicketType) : [];

const isPublicSiteIntakeField = (value: unknown): value is PublicSiteIntakeFieldPayload =>
	isRecord(value) &&
	typeof value.fieldId === 'string' &&
	typeof value.label === 'string' &&
	(value.fieldType === 'text' ||
		value.fieldType === 'textarea' ||
		value.fieldType === 'select' ||
		value.fieldType === 'checkbox') &&
	typeof value.required === 'boolean' &&
	Array.isArray(value.options) &&
	value.options.every((option) => typeof option === 'string');

const asPublicSiteIntakeFields = (value: unknown): PublicSiteIntakeFieldPayload[] =>
	Array.isArray(value) ? value.filter(isPublicSiteIntakeField) : [];

const asPublicEventsPage = (value: unknown): PublicEventsPagePayload => {
	if (Array.isArray(value)) {
		return {
			events: asPublicEvents(value),
			ticketTypes: []
		};
	}
	return {
		events: isRecord(value) ? asPublicEvents(value.events) : [],
		ticketTypes: isRecord(value) ? asPublicTicketTypes(value.ticketTypes) : []
	};
};

const asPublicEventDetail = (value: unknown): PublicEventDetailPayload | null => {
	if (!isPublicEvent(value)) {
		return null;
	}
	return {
		...value,
		ticketTypes: isRecord(value) ? asPublicTicketTypes(value.ticketTypes) : [],
		intakeFields: isRecord(value) ? asPublicSiteIntakeFields(value.intakeFields) : []
	};
};

export const getPublicEvents = query(
	publicEventsQuerySchema,
	async (context): Promise<PublicEventsPagePayload> => {
		const event = getRequestEvent();
		const response = await event.fetch(createApiUrl(publicEventsPath(context ?? {})), {
			method: 'GET'
		});
		const payload = await parseResponseBody(response);
		if (!response.ok) {
			if (response.status === 503) {
				throw new Error('公開イベント未設定です。');
			}
			throw new Error(toErrorMessage(payload, '公開イベントの取得に失敗しました。'));
		}
		return asPublicEventsPage(payload);
	}
);

export const getPublicEventDetail = query(
	publicEventDetailQuerySchema,
	async ({ slotId, orgSlug, storeSlug }): Promise<PublicEventDetailPayload> => {
		const event = getRequestEvent();
		const response = await event.fetch(
			createApiUrl(publicEventsPath({ orgSlug, storeSlug }, `/${encodeURIComponent(slotId)}`)),
			{
				method: 'GET'
			}
		);
		const payload = await parseResponseBody(response);
		if (!response.ok) {
			if (response.status === 503) {
				throw new Error('公開イベント未設定です。');
			}
			throw new Error(toErrorMessage(payload, '公開イベント詳細の取得に失敗しました。'));
		}
		const detail = asPublicEventDetail(payload);
		if (!detail) {
			throw new Error('公開イベント詳細の形式が不正です。');
		}
		return detail;
	}
);
