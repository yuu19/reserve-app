import type {
	CreatePublicBookingInput,
	PublicBookingResultPayload,
	PublicEventDetailPayload,
	PublicEventsPagePayload,
	ScopedApiContext
} from '$lib/rpc-client';
import { authRpc } from '$lib/rpc-client';
import { getPublicEventDetail, getPublicEvents } from '$lib/remote/events-page.remote';
import { createBooking } from './bookings.svelte';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';

type JsonRecord = Record<string, unknown>;

type PublicEventsContext = {
	orgSlug?: string;
	storeSlug?: string;
};

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

export const loadPublicEvents = async (
	context?: PublicEventsContext
): Promise<PublicEventsPagePayload> => {
	return getPublicEvents(context ?? {});
};

export const loadPublicEventDetail = async (
	slotId: string,
	context?: PublicEventsContext
): Promise<PublicEventDetailPayload> => {
	return getPublicEventDetail({ slotId, ...(context ?? {}) });
};

export const ensureParticipantSelfEnrollment = async ({
	organizationId,
	storeId
}: {
	organizationId: string;
	storeId?: string | null;
}) => {
	const response = await authRpc.selfEnrollParticipant({
		organizationId,
		storeId: storeId ?? undefined
	});
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
	storeId,
	slotId
}: {
	organizationId: string;
	storeId?: string | null;
	slotId: string;
}) => {
	const enrollmentResult = await ensureParticipantSelfEnrollment({ organizationId, storeId });
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

const isPublicBookingResult = (value: unknown): value is PublicBookingResultPayload =>
	isRecord(value) &&
	typeof value.bookingId === 'string' &&
	typeof value.bookingPublicId === 'string' &&
	(value.status === 'confirmed' || value.status === 'pending_approval');

export const createGuestPublicBooking = async (
	context: ScopedApiContext,
	input: CreatePublicBookingInput
) => {
	const response = await authRpc.createPublicBooking(context, input);
	const payload = await parseResponseBody(response);
	const booking = response.ok && isPublicBookingResult(payload) ? payload : null;
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? '予約を受け付けました。'
			: toErrorMessage(payload, '予約の作成に失敗しました。'),
		booking
	};
};
