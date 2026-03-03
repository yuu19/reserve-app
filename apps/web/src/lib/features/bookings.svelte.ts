import {
	authRpc,
	type BookingPayload,
	type ServiceImageUploadUrlPayload
} from '$lib/rpc-client';
import { formatJaMonth, formatJaTime } from '$lib/date/format';
import { getAdminBookingsOperationsPageData } from '$lib/remote/admin-bookings-operations.remote';
import { getAdminRecurringPageData } from '$lib/remote/admin-recurring-page.remote';
import { getAdminServicesPageData } from '$lib/remote/admin-services-page.remote';
import { getAdminSlotsPageData } from '$lib/remote/admin-slots-page.remote';
import { getParticipantBookingsPageData } from '$lib/remote/participant-bookings-page.remote';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';

dayjs.extend(utc);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;
const extractMessage = (payload: unknown): string | null =>
	isRecord(payload) && typeof payload.message === 'string' ? payload.message : null;

const extractValidationErrorMessage = (payload: unknown): string | null => {
	if (!isRecord(payload)) {
		return null;
	}

	const extractFromIssues = (issues: unknown): string | null => {
		if (!Array.isArray(issues)) {
			return null;
		}
		for (const issue of issues) {
			if (isRecord(issue) && typeof issue.message === 'string' && issue.message.length > 0) {
				return issue.message;
			}
		}
		return null;
	};

	const topLevel = extractFromIssues(payload.issues);
	if (topLevel) {
		return topLevel;
	}

	if (isRecord(payload.error)) {
		return extractFromIssues(payload.error.issues);
	}

	return null;
};

const isBooking = (value: unknown): value is BookingPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.slotId === 'string';
const isServiceImageUploadUrlPayload = (value: unknown): value is ServiceImageUploadUrlPayload =>
	isRecord(value) &&
	typeof value.key === 'string' &&
	typeof value.uploadUrl === 'string' &&
	typeof value.imageUrl === 'string' &&
	typeof value.expiresAt === 'string' &&
	typeof value.contentType === 'string' &&
	typeof value.maxUploadBytes === 'number';

export const toReservationErrorMessage = (status: number, payload: unknown, fallback: string) => {
	const message = extractMessage(payload);
	if (status === 401) {
		return 'セッションの有効期限が切れました。再ログインしてください。';
	}
	if (status === 403) {
		return 'この操作には参加者所属または管理権限が必要です。';
	}
	if (status === 404) {
		if (message === 'Recurring schedule not found.') {
			return '定期スケジュールが見つかりません。最新状態を読み直してください。';
		}
	}
	if (status === 409) {
		if (message === 'Duplicate booking is not allowed.') {
			return 'この枠にはすでに予約履歴があります。別の枠を選択してください。';
		}
		if (message === 'Slot is full or not bookable.' || message === 'Slot is not bookable.') {
			return 'この枠は満席または受付時間外です。別の枠を選択してください。';
		}
		if (message === 'No available ticket pack for booking.') {
			return 'このサービスの予約には有効な回数券が必要です。';
		}
		if (message === 'Booking cannot be canceled.') {
			return 'この予約は運営キャンセルできません。';
		}
		if (message === 'Only confirmed booking can be marked as no-show.') {
			return 'No-show にできるのは予約確定済みの予約のみです。';
		}
		if (message === 'Only pending approval booking can be approved.') {
			return '承認できるのは承認待ち予約のみです。';
		}
		if (message === 'Only pending approval booking can be rejected.') {
			return '却下できるのは承認待ち予約のみです。';
		}
		if (message === 'Slot is not open.') {
			return 'この枠はすでに停止されているため操作できません。';
		}
		return '予約状態が更新されました。満席・重複・受付時間を確認して再試行してください。';
	}
	if (status === 422) {
		if (message === 'Override action requires at least one override field.') {
			return 'override を選択した場合は、上書き項目を1つ以上入力してください。';
		}
		if (message === 'Invalid from/to.') {
			return '生成期間の開始・終了日時が不正です。';
		}
	}
	const validationError = extractValidationErrorMessage(payload);
	if (validationError) {
		return validationError;
	}
	return toErrorMessage(payload, fallback);
};

export const parseNumberInput = (value: string | number): number | undefined => {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : undefined;
	}
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
	const parsed = dayjs(`${date}T${time}`);
	if (!parsed.isValid()) {
		return null;
	}
	return parsed.utc().toISOString();
};

export const toDayBoundaryIso = (date: string, atEnd: boolean): string | null => {
	if (!date) {
		return null;
	}
	const timePart = atEnd ? '23:59:59' : '00:00:00';
	const parsed = dayjs(`${date}T${timePart}`);
	if (!parsed.isValid()) {
		return null;
	}
	return parsed.utc().toISOString();
};

export const defaultDate = (offsetDays: number): string =>
	dayjs().add(offsetDays, 'day').format('YYYY-MM-DD');

export const toDateKey = (value: Date): string => dayjs(value).format('YYYY-MM-DD');

export const toDateKeyFromIso = (value: string): string => {
	const parsed = dayjs(value);
	if (!parsed.isValid()) {
		return '';
	}
	return parsed.format('YYYY-MM-DD');
};

export const formatMonthLabel = (monthDate: Date): string => formatJaMonth(monthDate, '');

export const formatTimeLabel = (iso: string): string => {
	return formatJaTime(iso, '--:--');
};

export const getMonthDateRange = (monthDate: Date) => {
	const parsed = dayjs(monthDate);
	return {
		fromDate: parsed.startOf('month').format('YYYY-MM-DD'),
		toDate: parsed.endOf('month').format('YYYY-MM-DD')
	};
};

export const buildCalendarDays = (monthDate: Date): Date[] => {
	const firstDay = dayjs(monthDate).startOf('month');
	const lastDay = dayjs(monthDate).endOf('month');
	const calendarStart = firstDay.subtract(firstDay.day(), 'day');
	const calendarEnd = lastDay.add(6 - lastDay.day(), 'day');

	const days: Date[] = [];
	let cursor = calendarStart;
	while (cursor.isBefore(calendarEnd) || cursor.isSame(calendarEnd, 'day')) {
		days.push(cursor.toDate());
		cursor = cursor.add(1, 'day');
	}
	return days;
};

export const loadAdminBookingsOperationsData = async (from: string, to: string, serviceId?: string) => {
	return getAdminBookingsOperationsPageData({ from, to, serviceId: serviceId || undefined });
};

export const loadAdminServicesData = async (from: string, to: string) => {
	return getAdminServicesPageData({ from, to });
};

export const loadAdminSlotsData = async (from: string, to: string, serviceId?: string) => {
	return getAdminSlotsPageData({ from, to, serviceId: serviceId || undefined });
};

export const loadAdminRecurringData = async (from: string, to: string) => {
	return getAdminRecurringPageData({ from, to });
};

export const loadParticipantBookingsData = async (from: string, to: string, serviceId?: string) => {
	return getParticipantBookingsPageData({ from, to, serviceId: serviceId || undefined });
};

export const createService = async (input: {
	organizationId: string;
	name: string;
	description?: string | null;
	imageUrl?: string | null;
	kind: 'single' | 'recurring';
	bookingPolicy: 'instant' | 'approval';
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

export const updateServiceByStaff = async (input: {
	serviceId: string;
	name?: string;
	description?: string | null;
	imageUrl?: string | null;
	kind?: 'single' | 'recurring';
	bookingPolicy?: 'instant' | 'approval';
	durationMinutes?: number;
	capacity?: number;
	cancellationDeadlineMinutes?: number;
	requiresTicket?: boolean;
	isActive?: boolean;
}) => {
	const response = await authRpc.updateService(input);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? 'サービスを更新しました。'
			: toReservationErrorMessage(response.status, payload, 'サービス更新に失敗しました。')
	};
};

export const uploadServiceImage = async ({
	organizationId,
	file
}: {
	organizationId: string;
	file: File;
}) => {
	const signedUrlResponse = await authRpc.createServiceImageUploadUrl({
		organizationId,
		fileName: file.name,
		contentType: file.type,
		size: file.size
	});
	const signedUrlPayload = await parseResponseBody(signedUrlResponse);
	if (!signedUrlResponse.ok || !isServiceImageUploadUrlPayload(signedUrlPayload)) {
		return {
			ok: false,
			message: toReservationErrorMessage(
				signedUrlResponse.status,
				signedUrlPayload,
				'サービス画像アップロードURLの取得に失敗しました。'
			),
			imageUrl: null as string | null
		};
	}

	const uploadResponse = await authRpc.uploadServiceImageBySignedUrl(
		signedUrlPayload.uploadUrl,
		file,
		signedUrlPayload.contentType
	);
	const uploadPayload = await parseResponseBody(uploadResponse);
	if (!uploadResponse.ok) {
		return {
			ok: false,
			message: toReservationErrorMessage(
				uploadResponse.status,
				uploadPayload,
				'サービス画像のアップロードに失敗しました。'
			),
			imageUrl: null as string | null
		};
	}

	return {
		ok: true,
		message: 'サービス画像をアップロードしました。',
		imageUrl: signedUrlPayload.imageUrl
	};
};

export const archiveServiceByStaff = async (serviceId: string) => {
	const response = await authRpc.archiveService({ serviceId });
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? 'サービスを停止しました。'
			: toReservationErrorMessage(response.status, payload, 'サービス停止に失敗しました。')
	};
};

export const resumeServiceByStaff = async (serviceId: string) => {
	const response = await authRpc.updateService({ serviceId, isActive: true });
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? 'サービスを再開しました。'
			: toReservationErrorMessage(response.status, payload, 'サービス再開に失敗しました。')
	};
};

export const cancelSlotByStaff = async (slotId: string, reason?: string) => {
	const normalizedReason = reason?.trim() ? reason.trim() : undefined;
	const response = await authRpc.cancelSlot({ slotId, reason: normalizedReason });
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? '単発枠を停止しました。'
			: toReservationErrorMessage(response.status, payload, '単発枠の停止に失敗しました。')
	};
};

export const updateRecurringScheduleByStaff = async (input: {
	recurringScheduleId: string;
	frequency?: 'weekly' | 'monthly';
	interval?: number;
	byWeekday?: number[];
	byMonthday?: number;
	startDate?: string;
	endDate?: string;
	startTimeLocal?: string;
	durationMinutes?: number;
	capacityOverride?: number;
	isActive?: boolean;
}) => {
	const response = await authRpc.updateRecurringSchedule(input);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? '定期スケジュールを更新しました。'
			: toReservationErrorMessage(response.status, payload, '定期スケジュール更新に失敗しました。')
	};
};

export const upsertRecurringExceptionByStaff = async (input: {
	recurringScheduleId: string;
	date: string;
	action: 'skip' | 'override';
	overrideStartTimeLocal?: string;
	overrideDurationMinutes?: number;
	overrideCapacity?: number;
}) => {
	const response = await authRpc.upsertRecurringScheduleException(input);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? '定期スケジュール例外を登録しました。'
			: toReservationErrorMessage(
					response.status,
					payload,
					'定期スケジュール例外登録に失敗しました。'
				)
	};
};

export const generateRecurringSlotsByStaff = async (input: {
	recurringScheduleId: string;
	from?: string;
	to?: string;
}) => {
	const response = await authRpc.generateRecurringSlots(input);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? '定期スロットを再生成しました。'
			: toReservationErrorMessage(response.status, payload, '定期スロット再生成に失敗しました。')
	};
};

export const createBooking = async (slotId: string) => {
	const response = await authRpc.createBooking({ slotId, participantsCount: 1 });
	const payload = await parseResponseBody(response);
	const status = isBooking(payload) ? payload.status : null;
	return {
		ok: response.ok,
		message: response.ok
			? status === 'pending_approval'
				? '予約申請を受け付けました。'
				: '予約を申し込みました。'
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

export const cancelBookingByStaff = async (bookingId: string, reason?: string) => {
	const normalizedReason = reason?.trim() ? reason.trim() : undefined;
	const response = await authRpc.cancelBookingByStaff({ bookingId, reason: normalizedReason });
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? '予約を運営キャンセルしました。'
			: toReservationErrorMessage(response.status, payload, '運営キャンセルに失敗しました。')
	};
};

export const markBookingNoShow = async (bookingId: string) => {
	const response = await authRpc.markBookingNoShow({ bookingId });
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? '予約を No-show に更新しました。'
			: toReservationErrorMessage(response.status, payload, 'No-show 更新に失敗しました。')
	};
};

export const approveBooking = async (bookingId: string) => {
	const response = await authRpc.approveBooking(bookingId);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? '予約を承認しました。'
			: toReservationErrorMessage(response.status, payload, '予約承認に失敗しました。')
	};
};

export const rejectBooking = async (bookingId: string, reason?: string) => {
	const normalizedReason = reason?.trim() ? reason.trim() : undefined;
	const response = await authRpc.rejectBooking({ bookingId, reason: normalizedReason });
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		message: response.ok
			? '予約を却下しました。'
			: toReservationErrorMessage(response.status, payload, '予約却下に失敗しました。')
	};
};
