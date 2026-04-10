import { query } from '$app/server';
import type {
	BookingPayload,
	ParticipantPayload,
	ScopedApiContext,
	ServicePayload,
	SlotPayload
} from '$lib/rpc-client';
import { readOrganizationPremiumRestriction } from '$lib/features/premium-restrictions';
import { createApiGetter, resolveScopedAccessContext, type ApiResult } from '$lib/server/scoped-api';
import { z } from 'zod';

const adminBookingsOperationsQuerySchema = z.object({
	orgSlug: z.string().trim().min(1),
	classroomSlug: z.string().trim().min(1),
	from: z.string().trim().min(1),
	to: z.string().trim().min(1),
	serviceId: z.string().trim().min(1).optional()
});

type JsonRecord = Record<string, unknown>;

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

const isService = (value: unknown): value is ServicePayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';

const isSlot = (value: unknown): value is SlotPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.serviceId === 'string';

const isBooking = (value: unknown): value is BookingPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.slotId === 'string';

const isParticipant = (value: unknown): value is ParticipantPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.organizationId === 'string' &&
	typeof value.email === 'string';

const asServices = (value: unknown): ServicePayload[] =>
	Array.isArray(value) ? value.filter(isService) : [];

const asSlots = (value: unknown): SlotPayload[] => (Array.isArray(value) ? value.filter(isSlot) : []);

const asBookings = (value: unknown): BookingPayload[] =>
	Array.isArray(value) ? value.filter(isBooking) : [];

const asParticipants = (value: unknown): ParticipantPayload[] =>
	Array.isArray(value) ? value.filter(isParticipant) : [];

const assertAllowedFailure = (result: ApiResult, fallback: string) => {
	if (result.response.ok) {
		return;
	}
	throw new Error(toErrorMessage(result.payload, fallback));
};

export const getAdminBookingsOperationsPageData = query(
	adminBookingsOperationsQuerySchema,
	async ({ orgSlug, classroomSlug, from, to, serviceId }) => {
		const getApi = createApiGetter();
		const activeContext: ScopedApiContext = { orgSlug, classroomSlug };
		const scopedAccess = await resolveScopedAccessContext(getApi, activeContext);
		if (!scopedAccess) {
			return {
				activeContext: null,
				organizationId: null as string | null,
				canManage: false,
				premiumRestriction: null,
				services: [] as ServicePayload[],
				slots: [] as SlotPayload[],
				staffBookings: [] as BookingPayload[],
				staffParticipants: [] as ParticipantPayload[]
			};
		}

		if (!scopedAccess.effective.canManageBookings) {
			return {
				activeContext,
				organizationId: scopedAccess.organizationId,
				canManage: false,
				premiumRestriction: null,
				services: [] as ServicePayload[],
				slots: [] as SlotPayload[],
				staffBookings: [] as BookingPayload[],
				staffParticipants: [] as ParticipantPayload[]
			};
		}

		const scopedQuery = {
			organizationId: scopedAccess.organizationId,
			classroomId: scopedAccess.classroomId
		};
		const [servicesResult, slotsResult, staffBookingsResult, participantsResult] = await Promise.all([
			getApi('/api/v1/auth/organizations/services', scopedQuery),
			getApi('/api/v1/auth/organizations/slots', {
				...scopedQuery,
				from,
				to,
				serviceId
			}),
			getApi('/api/v1/auth/organizations/bookings', {
				...scopedQuery,
				from,
				to,
				serviceId
			}),
			getApi('/api/v1/auth/organizations/participants', scopedQuery)
		]);

		const premiumRestriction =
			readOrganizationPremiumRestriction(servicesResult.payload) ??
			readOrganizationPremiumRestriction(slotsResult.payload) ??
			readOrganizationPremiumRestriction(staffBookingsResult.payload) ??
			readOrganizationPremiumRestriction(participantsResult.payload);
		if (premiumRestriction) {
			return {
				activeContext,
				organizationId: scopedAccess.organizationId,
				canManage: true,
				premiumRestriction,
				services: [] as ServicePayload[],
				slots: [] as SlotPayload[],
				staffBookings: [] as BookingPayload[],
				staffParticipants: [] as ParticipantPayload[]
			};
		}

		assertAllowedFailure(servicesResult, 'サービス一覧の取得に失敗しました。');
		assertAllowedFailure(slotsResult, '枠一覧の取得に失敗しました。');
		assertAllowedFailure(staffBookingsResult, '運営予約一覧の取得に失敗しました。');
		assertAllowedFailure(participantsResult, '参加者一覧の取得に失敗しました。');

		return {
			activeContext,
			organizationId: scopedAccess.organizationId,
			canManage: true,
			premiumRestriction: null,
			services: asServices(servicesResult.payload),
			slots: asSlots(slotsResult.payload),
			staffBookings: asBookings(staffBookingsResult.payload),
			staffParticipants: asParticipants(participantsResult.payload)
		};
	}
);
