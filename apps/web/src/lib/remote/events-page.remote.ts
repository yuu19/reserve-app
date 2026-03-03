import { env } from '$env/dynamic/public';
import { getRequestEvent, query } from '$app/server';
import type { PublicEventDetailPayload, PublicEventListItemPayload } from '$lib/rpc-client';
import { z } from 'zod';

const defaultBackendUrl = 'http://localhost:3000';

type JsonRecord = Record<string, unknown>;

const publicEventDetailQuerySchema = z.object({
	slotId: z.string().trim().min(1)
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

const isPublicEvent = (value: unknown): value is PublicEventListItemPayload =>
	isRecord(value) &&
	typeof value.organizationId === 'string' &&
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

export const getPublicEvents = query(async (): Promise<PublicEventListItemPayload[]> => {
	const event = getRequestEvent();
	const response = await event.fetch(createApiUrl('/api/v1/public/events'), {
		method: 'GET'
	});
	const payload = await parseResponseBody(response);
	if (!response.ok) {
		if (response.status === 503) {
			throw new Error('公開イベント未設定です。');
		}
		throw new Error(toErrorMessage(payload, '公開イベントの取得に失敗しました。'));
	}
	return asPublicEvents(payload);
});

export const getPublicEventDetail = query(
	publicEventDetailQuerySchema,
	async ({ slotId }): Promise<PublicEventDetailPayload> => {
		const event = getRequestEvent();
		const response = await event.fetch(
			createApiUrl(`/api/v1/public/events/${encodeURIComponent(slotId)}`),
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
		if (!isPublicEvent(payload)) {
			throw new Error('公開イベント詳細の形式が不正です。');
		}
		return payload;
	}
);
