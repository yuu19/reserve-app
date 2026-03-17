import { query } from '$app/server';
import type { ScopedApiContext, ServicePayload, SlotPayload } from '$lib/rpc-client';
import { createApiGetter, resolveScopedAccessContext, type ApiResult } from '$lib/server/scoped-api';
import { z } from 'zod';

const adminSlotsQuerySchema = z.object({
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

const asServices = (value: unknown): ServicePayload[] =>
	Array.isArray(value) ? value.filter(isService) : [];

const asSlots = (value: unknown): SlotPayload[] => (Array.isArray(value) ? value.filter(isSlot) : []);

const assertAllowedFailure = (result: ApiResult, fallback: string) => {
	if (result.response.ok) {
		return;
	}
	throw new Error(toErrorMessage(result.payload, fallback));
};

export const getAdminSlotsPageData = query(
	adminSlotsQuerySchema,
	async ({ orgSlug, classroomSlug, from, to, serviceId }) => {
		const getApi = createApiGetter();
		const activeContext: ScopedApiContext = { orgSlug, classroomSlug };
		const scopedAccess = await resolveScopedAccessContext(getApi, activeContext);
		if (!scopedAccess) {
			return {
				activeContext: null,
				canManage: false,
				services: [] as ServicePayload[],
				slots: [] as SlotPayload[]
			};
		}

		if (!scopedAccess.effective.canManageClassroom) {
			return {
				activeContext,
				canManage: false,
				services: [] as ServicePayload[],
				slots: [] as SlotPayload[]
			};
		}

		const scopedQuery = {
			organizationId: scopedAccess.organizationId,
			classroomId: scopedAccess.classroomId
		};
		const [servicesResult, slotsResult] = await Promise.all([
			getApi('/api/v1/auth/organizations/services', scopedQuery),
			getApi('/api/v1/auth/organizations/slots', {
				...scopedQuery,
				from,
				to,
				serviceId
			})
		]);

		assertAllowedFailure(servicesResult, 'サービス一覧の取得に失敗しました。');
		assertAllowedFailure(slotsResult, '枠一覧の取得に失敗しました。');

		return {
			activeContext,
			canManage: true,
			services: asServices(servicesResult.payload),
			slots: asSlots(slotsResult.payload)
		};
	}
);
