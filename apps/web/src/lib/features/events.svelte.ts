import type { PublicEventDetailPayload, PublicEventListItemPayload } from '$lib/rpc-client';
import { authRpc } from '$lib/rpc-client';
import { getPublicEventDetail, getPublicEvents } from '$lib/remote/events-page.remote';
import { createBooking } from './bookings.svelte';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';
import { readWindowScopedRouteContext } from './scoped-routing';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

const toSelfEnrollErrorMessage = (status: number, payload: unknown): string => {
	const message = toErrorMessage(payload, '参加登録に失敗しました。');
	if (status === 400) {
		if (
			message === 'Current user email is unavailable.' ||
			message === 'Current user name is unavailable.'
		) {
			return 'プロフィール（名前・メールアドレス）を確認してから再試行してください。';
		}
	}
	return message;
};

export const loadPublicEvents = async (): Promise<PublicEventListItemPayload[]> => {
	return getPublicEvents();
};

export const loadPublicEventDetail = async (slotId: string): Promise<PublicEventDetailPayload> => {
	return getPublicEventDetail({ slotId });
};

export const ensureParticipantSelfEnrollment = async (_organizationId: string) => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			ok: false,
			created: false,
			message: 'URL に組織/教室コンテキストがありません。'
		};
	}
	const response = await authRpc.selfEnrollParticipantScoped(context);
	const payload = await parseResponseBody(response);
	if (!response.ok) {
		return {
			ok: false,
			created: false,
			message: toSelfEnrollErrorMessage(response.status, payload)
		};
	}

	const created = isRecord(payload) && payload.created === true;
	return {
		ok: true,
		created,
		message: created ? '参加登録が完了しました。' : '参加登録は完了済みです。'
	};
};

export const reservePublicEvent = async ({
	organizationId,
	slotId
}: {
	organizationId: string;
	slotId: string;
}) => {
	const enrollmentResult = await ensureParticipantSelfEnrollment(organizationId);
	if (!enrollmentResult.ok) {
		return {
			ok: false,
			createdParticipant: false,
			message: enrollmentResult.message
		};
	}

	const bookingResult = await createBooking(slotId);
	return {
		ok: bookingResult.ok,
		createdParticipant: enrollmentResult.created,
		message: bookingResult.message
	};
};
