import { env } from '$env/dynamic/public';
import { getRequestEvent, query } from '$app/server';
import type {
	BookingPayload,
	ParticipantPayload,
	RecurringSchedulePayload,
	ScopedApiContext,
	ServicePayload,
	SlotPayload,
	TicketPackPayload,
	TicketPurchasePayload,
	TicketTypePayload
} from '$lib/rpc-client';
import { z } from 'zod';

const defaultBackendUrl = 'http://localhost:3000';

const bookingsPageQuerySchema = z.object({
	orgSlug: z.string().trim().min(1),
	classroomSlug: z.string().trim().min(1),
	from: z.string().trim().min(1),
	to: z.string().trim().min(1),
	serviceId: z.string().trim().min(1).optional()
});

type QueryValue = string | number | boolean | undefined;

type JsonRecord = Record<string, unknown>;

type ApiResult = {
	response: Response;
	payload: unknown;
};

type BookingsPageData = {
	activeContext: ScopedApiContext;
	canManage: boolean;
	services: ServicePayload[];
	recurringSchedules: RecurringSchedulePayload[];
	slots: SlotPayload[];
	availableSlots: SlotPayload[];
	myBookings: BookingPayload[];
	myTicketPacks: TicketPackPayload[];
	purchasableTicketTypes: TicketTypePayload[];
	myTicketPurchases: TicketPurchasePayload[];
	staffBookings: BookingPayload[];
	staffParticipants: ParticipantPayload[];
	staffServices: ServicePayload[];
	staffRecurringSchedules: RecurringSchedulePayload[];
	participantAccessDenied: boolean;
};

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

const createApiUrl = (path: string, query: Record<string, QueryValue> = {}): string => {
	const backendUrl = env.PUBLIC_BACKEND_URL || defaultBackendUrl;
	const url = new URL(path, backendUrl);
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined) {
			continue;
		}
		url.searchParams.set(key, String(value));
	}
	return url.toString();
};

const createForwardHeaders = () => {
	const event = getRequestEvent();
	const headers = new Headers();
	const cookie = event.request.headers.get('cookie');
	if (cookie) {
		headers.set('cookie', cookie);
	}
	const userAgent = event.request.headers.get('user-agent');
	if (userAgent) {
		headers.set('user-agent', userAgent);
	}
	return headers;
};

const createApiGetter = () => {
	const event = getRequestEvent();
	const headers = createForwardHeaders();
	return async (path: string, query?: Record<string, QueryValue>): Promise<ApiResult> => {
		const response = await event.fetch(createApiUrl(path, query), {
			method: 'GET',
			headers
		});
		const payload = await parseResponseBody(response);
		return { response, payload };
	};
};

const isService = (value: unknown): value is ServicePayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';

const isRecurring = (value: unknown): value is RecurringSchedulePayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.serviceId === 'string';

const isSlot = (value: unknown): value is SlotPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.serviceId === 'string';

const isBooking = (value: unknown): value is BookingPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.slotId === 'string';

const isParticipant = (value: unknown): value is ParticipantPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.organizationId === 'string' &&
	typeof value.email === 'string';

const isTicketPack = (value: unknown): value is TicketPackPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.organizationId === 'string' &&
	typeof value.ticketTypeId === 'string';

const isTicketType = (value: unknown): value is TicketTypePayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.organizationId === 'string' &&
	typeof value.name === 'string';

const isTicketPurchase = (value: unknown): value is TicketPurchasePayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.organizationId === 'string' &&
	typeof value.participantId === 'string' &&
	typeof value.ticketTypeId === 'string' &&
	typeof value.paymentMethod === 'string' &&
	typeof value.status === 'string';

const asServices = (value: unknown): ServicePayload[] =>
	Array.isArray(value) ? value.filter(isService) : [];

const asRecurring = (value: unknown): RecurringSchedulePayload[] =>
	Array.isArray(value) ? value.filter(isRecurring) : [];

const asSlots = (value: unknown): SlotPayload[] => (Array.isArray(value) ? value.filter(isSlot) : []);

const asBookings = (value: unknown): BookingPayload[] =>
	Array.isArray(value) ? value.filter(isBooking) : [];

const asParticipants = (value: unknown): ParticipantPayload[] =>
	Array.isArray(value) ? value.filter(isParticipant) : [];

const asTicketPacks = (value: unknown): TicketPackPayload[] =>
	Array.isArray(value) ? value.filter(isTicketPack) : [];

const asTicketTypes = (value: unknown): TicketTypePayload[] =>
	Array.isArray(value) ? value.filter(isTicketType) : [];

const asTicketPurchases = (value: unknown): TicketPurchasePayload[] =>
	Array.isArray(value) ? value.filter(isTicketPurchase) : [];

const buildScopedPath = (context: ScopedApiContext, suffix: string) =>
	`/api/v1/auth/orgs/${encodeURIComponent(context.orgSlug)}/classrooms/${encodeURIComponent(context.classroomSlug)}${suffix}`;

const assertAllowedFailure = (
	result: ApiResult,
	fallback: string,
	options: { allowForbidden?: boolean } = {}
) => {
	if (result.response.ok) {
		return;
	}
	if (options.allowForbidden && result.response.status === 403) {
		return;
	}
	throw new Error(toErrorMessage(result.payload, fallback));
};

export const getBookingsPageData = query(
	bookingsPageQuerySchema,
	async ({ orgSlug, classroomSlug, from, to, serviceId }): Promise<BookingsPageData> => {
		const getApi = createApiGetter();
		const activeContext: ScopedApiContext = { orgSlug, classroomSlug };
		const scopedPath = (suffix: string) => buildScopedPath(activeContext, suffix);

		const [
			servicesResult,
			recurringResult,
			slotsResult,
			availableResult,
			myBookingsResult,
			myTicketPacksResult,
			purchasableTicketTypesResult,
			myTicketPurchasesResult,
			participantsResult,
			participantInvitationsResult
		] = await Promise.all([
			getApi(scopedPath('/services')),
			getApi(scopedPath('/recurring-schedules'), {
				isActive: true
			}),
			getApi(scopedPath('/slots'), {
				from,
				to
			}),
			getApi(scopedPath('/slots/available'), {
				from,
				to,
				serviceId
			}),
			getApi(scopedPath('/bookings/mine')),
			getApi(scopedPath('/ticket-packs/mine')),
			getApi(scopedPath('/ticket-types/purchasable')),
			getApi(scopedPath('/ticket-purchases/mine')),
			getApi(scopedPath('/participants')),
			getApi(scopedPath('/participants/invitations'))
		]);

		assertAllowedFailure(servicesResult, 'サービス一覧の取得に失敗しました。', {
			allowForbidden: true
		});
		assertAllowedFailure(recurringResult, '定期スケジュールの取得に失敗しました。', {
			allowForbidden: true
		});
		assertAllowedFailure(slotsResult, '枠一覧の取得に失敗しました。', {
			allowForbidden: true
		});
		assertAllowedFailure(availableResult, '空き枠一覧の取得に失敗しました。', {
			allowForbidden: true
		});
		assertAllowedFailure(myBookingsResult, 'マイ予約一覧の取得に失敗しました。', {
			allowForbidden: true
		});
		assertAllowedFailure(myTicketPacksResult, 'マイ回数券の取得に失敗しました。', {
			allowForbidden: true
		});
		assertAllowedFailure(purchasableTicketTypesResult, '購入可能回数券の取得に失敗しました。', {
			allowForbidden: true
		});
		assertAllowedFailure(myTicketPurchasesResult, '回数券購入申請の取得に失敗しました。', {
			allowForbidden: true
		});
		assertAllowedFailure(participantsResult, '参加者一覧の取得に失敗しました。', {
			allowForbidden: true
		});
		assertAllowedFailure(participantInvitationsResult, '参加者招待一覧の取得に失敗しました。', {
			allowForbidden: true
		});

		const canManage = participantsResult.response.ok && participantInvitationsResult.response.ok;
		const participantAccessDenied =
			availableResult.response.status === 403 ||
			myBookingsResult.response.status === 403 ||
			myTicketPacksResult.response.status === 403 ||
			purchasableTicketTypesResult.response.status === 403 ||
			myTicketPurchasesResult.response.status === 403;

		let staffBookings: BookingPayload[] = [];
		let staffServices: ServicePayload[] = [];
		let staffRecurringSchedules: RecurringSchedulePayload[] = [];

		if (canManage) {
			const [staffBookingsResult, staffServicesResult, staffRecurringResult] = await Promise.all([
				getApi(scopedPath('/bookings')),
				getApi(scopedPath('/services'), {
					includeArchived: true
				}),
				getApi(scopedPath('/recurring-schedules'))
			]);

			assertAllowedFailure(staffBookingsResult, '運営予約一覧の取得に失敗しました。');
			assertAllowedFailure(staffServicesResult, '運営サービス一覧の取得に失敗しました。');
			assertAllowedFailure(staffRecurringResult, '運営定期スケジュール一覧の取得に失敗しました。');

			staffBookings = asBookings(staffBookingsResult.payload);
			staffServices = asServices(staffServicesResult.payload);
			staffRecurringSchedules = asRecurring(staffRecurringResult.payload);
		}

		return {
			activeContext,
			canManage,
			services: asServices(servicesResult.payload),
			recurringSchedules: asRecurring(recurringResult.payload),
			slots: asSlots(slotsResult.payload),
			availableSlots: asSlots(availableResult.payload),
			myBookings: asBookings(myBookingsResult.payload),
			myTicketPacks: asTicketPacks(myTicketPacksResult.payload),
			purchasableTicketTypes: asTicketTypes(purchasableTicketTypesResult.payload),
			myTicketPurchases: asTicketPurchases(myTicketPurchasesResult.payload),
			staffBookings,
			staffParticipants: asParticipants(participantsResult.payload),
			staffServices,
			staffRecurringSchedules,
			participantAccessDenied
		};
	}
);
