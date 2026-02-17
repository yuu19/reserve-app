import {
	authRpc,
	type BookingPayload,
	type RecurringSchedulePayload,
	type ServicePayload,
	type SlotPayload
} from '$lib/rpc-client';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isService = (value: unknown): value is ServicePayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';

const isSlot = (value: unknown): value is SlotPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.serviceId === 'string';

const isRecurring = (value: unknown): value is RecurringSchedulePayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.serviceId === 'string';

const isBooking = (value: unknown): value is BookingPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.slotId === 'string';

const asServices = (value: unknown) => (Array.isArray(value) ? value.filter(isService) : []);
const asSlots = (value: unknown) => (Array.isArray(value) ? value.filter(isSlot) : []);
const asRecurring = (value: unknown) => (Array.isArray(value) ? value.filter(isRecurring) : []);
const asBookings = (value: unknown) => (Array.isArray(value) ? value.filter(isBooking) : []);

export const toReservationErrorMessage = (status: number, payload: unknown, fallback: string) => {
	if (status === 401) {
		return 'セッションの有効期限が切れました。再ログインしてください。';
	}
	if (status === 403) {
		return 'この操作には参加者所属または管理権限が必要です。';
	}
	if (status === 409) {
		return '予約状態が更新されました。満席・重複・受付時間を確認して再試行してください。';
	}
	return toErrorMessage(payload, fallback);
};

export const parseNumberInput = (value: string): number | undefined => {
	if (!value.trim()) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return undefined;
	}
	return parsed;
};

export const toIsoFromDateTime = (date: string, time: string): string | null => {
	if (!date || !time) {
		return null;
	}
	const parsed = new Date(`${date}T${time}`);
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}
	return parsed.toISOString();
};

export const toDayBoundaryIso = (date: string, atEnd: boolean): string | null => {
	if (!date) {
		return null;
	}
	const timePart = atEnd ? '23:59:59' : '00:00:00';
	const parsed = new Date(`${date}T${timePart}`);
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}
	return parsed.toISOString();
};

export const defaultDate = (offsetDays: number): string => {
	const date = new Date();
	date.setDate(date.getDate() + offsetDays);
	return date.toISOString().slice(0, 10);
};

export const loadBookingData = async (organizationId: string, from: string, to: string, serviceId?: string) => {
	const [servicesResponse, recurringResponse, slotsResponse, availableResponse, myBookingsResponse] =
		await Promise.all([
			authRpc.listServices({ organizationId }),
			authRpc.listRecurringSchedules({ organizationId, isActive: true }),
			authRpc.listSlots({ organizationId, from, to }),
			authRpc.listAvailableSlots({ organizationId, from, to, serviceId: serviceId || undefined }),
			authRpc.listMyBookings({ organizationId })
		]);

	const [servicesPayload, recurringPayload, slotsPayload, availablePayload, myPayload] = await Promise.all([
		parseResponseBody(servicesResponse),
		parseResponseBody(recurringResponse),
		parseResponseBody(slotsResponse),
		parseResponseBody(availableResponse),
		parseResponseBody(myBookingsResponse)
	]);

	return {
		services: servicesResponse.ok ? asServices(servicesPayload) : [],
		recurringSchedules: recurringResponse.ok ? asRecurring(recurringPayload) : [],
		slots: slotsResponse.ok ? asSlots(slotsPayload) : [],
		availableSlots: availableResponse.ok ? asSlots(availablePayload) : [],
		myBookings: myBookingsResponse.ok ? asBookings(myPayload) : [],
		errors: [
			!servicesResponse.ok
				? toReservationErrorMessage(servicesResponse.status, servicesPayload, 'サービス一覧の取得に失敗しました。')
				: null,
			!recurringResponse.ok
				? toReservationErrorMessage(recurringResponse.status, recurringPayload, '定期スケジュールの取得に失敗しました。')
				: null,
			!slotsResponse.ok
				? toReservationErrorMessage(slotsResponse.status, slotsPayload, '枠一覧の取得に失敗しました。')
				: null,
			!availableResponse.ok
				? toReservationErrorMessage(availableResponse.status, availablePayload, '空き枠一覧の取得に失敗しました。')
				: null,
			!myBookingsResponse.ok
				? toReservationErrorMessage(myBookingsResponse.status, myPayload, 'マイ予約一覧の取得に失敗しました。')
				: null
		].filter((msg): msg is string => msg !== null)
	};
};

export const createService = async (input: {
	organizationId: string;
	name: string;
	kind: 'single' | 'recurring';
	durationMinutes: number;
	capacity: number;
	requiresTicket: boolean;
	cancellationDeadlineMinutes?: number;
}) => {
	const response = await authRpc.createService(input);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? 'サービスを作成しました。'
			: toReservationErrorMessage(response.status, payload, 'サービス作成に失敗しました。')
	};
};

export const createSlot = async (input: {
	organizationId: string;
	serviceId: string;
	startAt: string;
	endAt: string;
	capacity?: number;
	staffLabel?: string;
	locationLabel?: string;
}) => {
	const response = await authRpc.createSlot(input);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? '単発枠を作成しました。'
			: toReservationErrorMessage(response.status, payload, '単発枠作成に失敗しました。')
	};
};

export const createRecurringSchedule = async (input: {
	organizationId: string;
	serviceId: string;
	frequency: 'weekly' | 'monthly';
	interval: number;
	byWeekday?: number[];
	byMonthday?: number;
	startDate: string;
	endDate?: string;
	startTimeLocal: string;
	durationMinutes?: number;
	capacityOverride?: number;
}) => {
	const response = await authRpc.createRecurringSchedule(input);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? '定期スケジュールを作成しました。'
			: toReservationErrorMessage(response.status, payload, '定期スケジュール作成に失敗しました。')
	};
};

export const createBooking = async (slotId: string) => {
	const response = await authRpc.createBooking({ slotId, participantsCount: 1 });
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? '予約を申し込みました。'
			: toReservationErrorMessage(response.status, payload, '予約申込に失敗しました。')
	};
};

export const cancelBooking = async (bookingId: string) => {
	const response = await authRpc.cancelBooking({ bookingId, reason: 'participant-cancelled' });
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? '予約をキャンセルしました。'
			: toReservationErrorMessage(response.status, payload, '予約キャンセルに失敗しました。')
	};
};
