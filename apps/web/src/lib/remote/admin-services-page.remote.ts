import { query } from '$app/server';
import type { ScopedApiContext, ServicePayload } from '$lib/rpc-client';
import { readOrganizationPremiumRestriction } from '$lib/features/premium-restrictions';
import { createApiGetter, resolveScopedAccessContext, type ApiResult } from '$lib/server/scoped-api';
import { z } from 'zod';

const adminServicesQuerySchema = z.object({
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

const asServices = (value: unknown): ServicePayload[] =>
	Array.isArray(value) ? value.filter(isService) : [];

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

export const getAdminServicesPageData = query(
	adminServicesQuerySchema,
	async ({ orgSlug, classroomSlug }) => {
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
				staffServices: [] as ServicePayload[]
			};
		}

		if (!scopedAccess.effective.canManageClassroom) {
			return {
				activeContext,
				organizationId: scopedAccess.organizationId,
				canManage: false,
				premiumRestriction: null,
				services: [] as ServicePayload[],
				staffServices: [] as ServicePayload[]
			};
		}

		const scopedQuery = {
			organizationId: scopedAccess.organizationId,
			classroomId: scopedAccess.classroomId
		};
		const [servicesResult, staffServicesResult] = await Promise.all([
			getApi('/api/v1/auth/organizations/services', scopedQuery),
			getApi('/api/v1/auth/organizations/services', {
				...scopedQuery,
				includeArchived: true
			})
		]);

		const premiumRestriction =
			readOrganizationPremiumRestriction(servicesResult.payload) ??
			readOrganizationPremiumRestriction(staffServicesResult.payload);
		if (premiumRestriction) {
			return {
				activeContext,
				organizationId: scopedAccess.organizationId,
				canManage: true,
				premiumRestriction,
				services: [] as ServicePayload[],
				staffServices: [] as ServicePayload[]
			};
		}

		assertAllowedFailure(servicesResult, 'サービス一覧の取得に失敗しました。');
		assertAllowedFailure(staffServicesResult, '運営サービス一覧の取得に失敗しました。');

		return {
			activeContext,
			organizationId: scopedAccess.organizationId,
			canManage: true,
			premiumRestriction: null,
			services: asServices(servicesResult.payload),
			staffServices: asServices(staffServicesResult.payload)
		};
	}
);
