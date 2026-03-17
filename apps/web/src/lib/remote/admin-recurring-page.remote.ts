import { query } from '$app/server';
import type {
	RecurringSchedulePayload,
	ScopedApiContext,
	ServicePayload
} from '$lib/rpc-client';
import { createApiGetter, resolveScopedAccessContext, type ApiResult } from '$lib/server/scoped-api';
import { z } from 'zod';

const adminRecurringQuerySchema = z.object({
	orgSlug: z.string().trim().min(1),
	classroomSlug: z.string().trim().min(1),
	from: z.string().trim().min(1),
	to: z.string().trim().min(1)
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

const isRecurring = (value: unknown): value is RecurringSchedulePayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.serviceId === 'string';

const asServices = (value: unknown): ServicePayload[] =>
	Array.isArray(value) ? value.filter(isService) : [];

const asRecurring = (value: unknown): RecurringSchedulePayload[] =>
	Array.isArray(value) ? value.filter(isRecurring) : [];

const assertAllowedFailure = (result: ApiResult, fallback: string) => {
	if (result.response.ok) {
		return;
	}
	throw new Error(toErrorMessage(result.payload, fallback));
};

export const getAdminRecurringPageData = query(
	adminRecurringQuerySchema,
	async ({ orgSlug, classroomSlug }) => {
		const getApi = createApiGetter();
		const activeContext: ScopedApiContext = { orgSlug, classroomSlug };
		const scopedAccess = await resolveScopedAccessContext(getApi, activeContext);
		if (!scopedAccess) {
			return {
				activeContext: null,
				canManage: false,
				services: [] as ServicePayload[],
				recurringSchedules: [] as RecurringSchedulePayload[],
				staffRecurringSchedules: [] as RecurringSchedulePayload[]
			};
		}

		if (!scopedAccess.effective.canManageClassroom) {
			return {
				activeContext,
				canManage: false,
				services: [] as ServicePayload[],
				recurringSchedules: [] as RecurringSchedulePayload[],
				staffRecurringSchedules: [] as RecurringSchedulePayload[]
			};
		}

		const scopedQuery = {
			organizationId: scopedAccess.organizationId,
			classroomId: scopedAccess.classroomId
		};
		const [servicesResult, recurringResult, staffRecurringResult] = await Promise.all([
			getApi('/api/v1/auth/organizations/services', scopedQuery),
			getApi('/api/v1/auth/organizations/recurring-schedules', {
				...scopedQuery,
				isActive: true
			}),
			getApi('/api/v1/auth/organizations/recurring-schedules', scopedQuery)
		]);

		assertAllowedFailure(servicesResult, 'サービス一覧の取得に失敗しました。');
		assertAllowedFailure(recurringResult, '定期スケジュールの取得に失敗しました。');
		assertAllowedFailure(staffRecurringResult, '運営定期スケジュール一覧の取得に失敗しました。');

		return {
			activeContext,
			canManage: true,
			services: asServices(servicesResult.payload),
			recurringSchedules: asRecurring(recurringResult.payload),
			staffRecurringSchedules: asRecurring(staffRecurringResult.payload)
		};
	}
);
