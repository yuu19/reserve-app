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
	context: ScopedApiContext
): Promise<PublicEventsPagePayload> => {
	return getPublicEvents(context);
};

export const loadPublicEventDetail = async (
	slotId: string,
	context: ScopedApiContext
): Promise<PublicEventDetailPayload> => {
	return getPublicEventDetail({ slotId, ...context });
};

export const ensureParticipantSelfEnrollment = async (context: ScopedApiContext) => {
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
	context,
	slotId
}: {
	context: ScopedApiContext;
	slotId: string;
}) => {
	const enrollmentResult = await ensureParticipantSelfEnrollment(context);
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

const toPublicBookingErrorMessage = (status: number, payload: unknown): string => {
	const message = toErrorMessage(payload, '予約の作成に失敗しました。');
	if (
		status === 409 &&
		(message === 'FORM_CONTEXT_OUTDATED' || message === 'FORM_VERSION_OUTDATED')
	) {
		return '予約フォームが更新されました。ページを再読み込みして入力し直してください。';
	}
	if (message === 'FORM_REQUIRED_FIELD_MISSING') {
		return '必須項目を入力してください。';
	}
	if (message === 'FORM_INVALID_VALUE' || message === 'FORM_INVALID_FIELD') {
		return 'フォームの入力内容を確認してください。';
	}
	return message;
};

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
			: toPublicBookingErrorMessage(response.status, payload),
		booking
	};
};
