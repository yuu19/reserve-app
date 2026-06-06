import type {
	ListNotificationOutboxQuery,
	NotificationOutboxAction,
	NotificationOutboxDetailPayload,
	NotificationOutboxListPayload,
	NotificationOutboxLogPayload,
	NotificationOutboxPayload,
	NotificationOutboxStatus,
	ScopedApiContext
} from '$lib/rpc-client';
import { authRpc } from '$lib/rpc-client';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';

type JsonRecord = Record<string, unknown>;

const notificationOutboxStatuses = new Set<NotificationOutboxStatus>([
	'pending',
	'processing',
	'sent',
	'retry',
	'cancelled',
	'dead',
	'skipped',
	'ambiguous'
]);

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

const isNullableString = (value: unknown): value is string | null =>
	typeof value === 'string' || value === null;

const isNotificationOutboxStatus = (value: unknown): value is NotificationOutboxStatus =>
	typeof value === 'string' && notificationOutboxStatuses.has(value as NotificationOutboxStatus);

const isNotificationOutboxPayload = (value: unknown): value is NotificationOutboxPayload => {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		typeof value.organizationId !== 'string' ||
		typeof value.storeId !== 'string' ||
		!isNullableString(value.bookingId) ||
		!isNullableString(value.participantId) ||
		typeof value.eventType !== 'string' ||
		typeof value.templateKey !== 'string' ||
		typeof value.channel !== 'string' ||
		typeof value.recipientType !== 'string' ||
		typeof value.recipientEmail !== 'string' ||
		!isNullableString(value.recipientName) ||
		!isNullableString(value.subjectSnapshot) ||
		!isNotificationOutboxStatus(value.status) ||
		!isNullableString(value.scheduledFor) ||
		!isNullableString(value.nextAttemptAt) ||
		typeof value.attemptCount !== 'number' ||
		typeof value.maxAttempts !== 'number' ||
		typeof value.idempotencyKey !== 'string' ||
		!isNullableString(value.lockedAt) ||
		!isNullableString(value.lockedBy) ||
		!isNullableString(value.lockExpiresAt) ||
		!isNullableString(value.provider) ||
		!isNullableString(value.providerMessageId) ||
		!isNullableString(value.lastError) ||
		!isNullableString(value.sentAt) ||
		!isNullableString(value.cancelledAt) ||
		!isNullableString(value.deadAt) ||
		!isNullableString(value.createdAt) ||
		!isNullableString(value.updatedAt)
	) {
		return false;
	}
	return true;
};

const isNotificationOutboxLogPayload = (value: unknown): value is NotificationOutboxLogPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	isNullableString(value.outboxId) &&
	typeof value.status === 'string' &&
	(typeof value.attemptNumber === 'number' || value.attemptNumber === null) &&
	isNullableString(value.provider) &&
	isNullableString(value.providerMessageId) &&
	isNullableString(value.errorMessage) &&
	isNullableString(value.responseJson) &&
	isNullableString(value.createdAt);

const isNotificationOutboxListPayload = (value: unknown): value is NotificationOutboxListPayload =>
	isRecord(value) &&
	Array.isArray(value.notifications) &&
	value.notifications.every(isNotificationOutboxPayload);

const isNotificationOutboxDetailPayload = (
	value: unknown
): value is NotificationOutboxDetailPayload =>
	isRecord(value) &&
	isNotificationOutboxPayload(value.notification) &&
	Array.isArray(value.logs) &&
	value.logs.every(isNotificationOutboxLogPayload);

export const loadNotificationOutboxList = async (
	context: ScopedApiContext,
	query?: ListNotificationOutboxQuery
): Promise<NotificationOutboxListPayload | null> => {
	const response = await authRpc.listNotificationOutbox(context, query);
	const payload = await parseResponseBody(response);
	if (!response.ok) {
		return null;
	}
	return isNotificationOutboxListPayload(payload) ? payload : null;
};

export const loadNotificationOutboxDetail = async (
	context: ScopedApiContext,
	outboxId: string
): Promise<NotificationOutboxDetailPayload | null> => {
	const response = await authRpc.getNotificationOutboxDetail(context, outboxId);
	const payload = await parseResponseBody(response);
	if (!response.ok) {
		return null;
	}
	return isNotificationOutboxDetailPayload(payload) ? payload : null;
};

export const applyNotificationOutboxAction = async (
	context: ScopedApiContext,
	outboxId: string,
	action: NotificationOutboxAction
) => {
	const response = await authRpc.applyNotificationOutboxAction(context, outboxId, action);
	const payload = await parseResponseBody(response);
	const detail = response.ok && isNotificationOutboxDetailPayload(payload) ? payload : null;
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? '通知状態を更新しました。'
			: toErrorMessage(payload, '通知状態の更新に失敗しました。'),
		detail
	};
};
