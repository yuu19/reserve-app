import { query } from '$app/server';
import { readOrganizationPremiumRestriction } from '$lib/features/premium-restrictions';
import type {
	ParticipantPayload,
	ScopedApiContext,
	ServicePayload,
	TicketPurchasePayload,
	TicketTypePayload
} from '$lib/rpc-client';
import {
	createApiGetter,
	resolveScopedAccessContext,
	type ApiResult,
	type QueryValue
} from '$lib/server/scoped-api';
import { z } from 'zod';

type JsonRecord = Record<string, unknown>;

type TicketManagementPageData = {
	activeContext: ScopedApiContext | null;
	organizationId: string | null;
	canManage: boolean;
	canManageParticipants: boolean;
	canManageClassroom: boolean;
	premiumRestriction: ReturnType<typeof readOrganizationPremiumRestriction>;
	participants: ParticipantPayload[];
	services: ServicePayload[];
	ticketTypes: TicketTypePayload[];
	ticketPurchases: TicketPurchasePayload[];
	loadError: string | null;
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

const toExceptionMessage = (error: unknown, fallback: string): string => {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	if (typeof error === 'string' && error.length > 0) {
		return error;
	}
	return fallback;
};

const isParticipant = (value: unknown): value is ParticipantPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.organizationId === 'string';

const isService = (value: unknown): value is ServicePayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';

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

const asParticipants = (value: unknown): ParticipantPayload[] =>
	Array.isArray(value) ? value.filter(isParticipant) : [];

const asServices = (value: unknown): ServicePayload[] =>
	Array.isArray(value) ? value.filter(isService) : [];

const asTicketTypes = (value: unknown): TicketTypePayload[] =>
	Array.isArray(value) ? value.filter(isTicketType) : [];

const asTicketPurchases = (value: unknown): TicketPurchasePayload[] =>
	Array.isArray(value) ? value.filter(isTicketPurchase) : [];

const createFailedApiResult = (message: string): ApiResult => ({
	response: new Response(JSON.stringify({ message }), {
		status: 503,
		headers: { 'content-type': 'application/json' }
	}),
	payload: { message }
});

const createSkippedApiResult = (): ApiResult => ({
	response: new Response(null, { status: 204 }),
	payload: null
});

const createSafeApiGetter =
	(getApi: ReturnType<typeof createApiGetter>) =>
	async (path: string, query?: Record<string, QueryValue>): Promise<ApiResult> => {
		try {
			return await getApi(path, query);
		} catch (error) {
			const message = toExceptionMessage(error, 'API リクエストに失敗しました。');
			console.error('getTicketManagementPageData request failed', { path, query, message });
			return createFailedApiResult(message);
		}
	};

const getDependencyFailureMessage = (
	result: ApiResult,
	fallback: string,
	options: { allowForbidden?: boolean } = {}
): string | null => {
	if (result.response.ok) {
		return null;
	}
	if (options.allowForbidden && result.response.status === 403) {
		return null;
	}
	return `${fallback} (${result.response.status}): ${toErrorMessage(result.payload, fallback)}`;
};

const createLoadError = (messages: Array<string | null>): string | null =>
	messages.some(Boolean)
		? '一部の回数券管理データを取得できませんでした。時間をおいて再読み込みしてください。'
		: null;

const ticketManagementPageQuerySchema = z.object({
	orgSlug: z.string().trim().min(1),
	classroomSlug: z.string().trim().min(1)
});

export const getTicketManagementPageData = query(
	ticketManagementPageQuerySchema,
	async ({ orgSlug, classroomSlug }): Promise<TicketManagementPageData> => {
		const getApi = createSafeApiGetter(createApiGetter());
		const activeContext: ScopedApiContext = { orgSlug, classroomSlug };
		const scopedAccess = await resolveScopedAccessContext(getApi, activeContext);
		if (!scopedAccess) {
			return {
				activeContext: null,
				organizationId: null,
				canManage: false,
				canManageParticipants: false,
				canManageClassroom: false,
				premiumRestriction: null,
				participants: [],
				services: [],
				ticketTypes: [],
				ticketPurchases: [],
				loadError: null
			};
		}

		const canManageParticipants = scopedAccess.effective.canManageParticipants;
		const canManageClassroom = scopedAccess.effective.canManageClassroom;
		const canManage = canManageParticipants || canManageClassroom;
		if (!canManage) {
			return {
				activeContext,
				organizationId: scopedAccess.organizationId,
				canManage: false,
				canManageParticipants: false,
				canManageClassroom: false,
				premiumRestriction: null,
				participants: [],
				services: [],
				ticketTypes: [],
				ticketPurchases: [],
				loadError: null
			};
		}

		const scopedQuery = {
			organizationId: scopedAccess.organizationId,
			classroomId: scopedAccess.classroomId
		};

		const [participantsResult, servicesResult, ticketTypesResult, ticketPurchasesResult] =
			await Promise.all([
				getApi('/api/v1/auth/organizations/participants', scopedQuery),
				canManageClassroom
					? getApi('/api/v1/auth/organizations/services', scopedQuery)
					: createSkippedApiResult(),
				getApi('/api/v1/auth/organizations/ticket-types', scopedQuery),
				canManageParticipants
					? getApi('/api/v1/auth/organizations/ticket-purchases', scopedQuery)
					: createSkippedApiResult()
			]);

		const debugResults = [
			['participants', participantsResult],
			['services', servicesResult],
			['ticket types', ticketTypesResult],
			['ticket purchases', ticketPurchasesResult]
		] as const;
		for (const [label, result] of debugResults) {
			if (result.response.ok || result.response.status === 403) {
				continue;
			}
			console.error('getTicketManagementPageData dependency failed', {
				label,
				status: result.response.status,
				detail: toErrorMessage(result.payload, '回数券管理ページ依存データの取得に失敗しました。'),
				orgSlug,
				classroomSlug
			});
		}

		const premiumRestriction =
			readOrganizationPremiumRestriction(participantsResult.payload) ??
			readOrganizationPremiumRestriction(servicesResult.payload) ??
			readOrganizationPremiumRestriction(ticketTypesResult.payload) ??
			readOrganizationPremiumRestriction(ticketPurchasesResult.payload);
		if (premiumRestriction) {
			return {
				activeContext,
				organizationId: scopedAccess.organizationId,
				canManage,
				canManageParticipants,
				canManageClassroom,
				premiumRestriction,
				participants: [],
				services: [],
				ticketTypes: [],
				ticketPurchases: [],
				loadError: null
			};
		}

		const loadError = createLoadError([
			getDependencyFailureMessage(participantsResult, '参加者情報の取得に失敗しました。', {
				allowForbidden: true
			}),
			getDependencyFailureMessage(servicesResult, 'サービス情報の取得に失敗しました。', {
				allowForbidden: true
			}),
			getDependencyFailureMessage(ticketTypesResult, '回数券種別の取得に失敗しました。', {
				allowForbidden: true
			}),
			getDependencyFailureMessage(ticketPurchasesResult, '回数券購入申請の取得に失敗しました。', {
				allowForbidden: true
			})
		]);

		return {
			activeContext,
			organizationId: scopedAccess.organizationId,
			canManage,
			canManageParticipants,
			canManageClassroom,
			premiumRestriction: null,
			participants: asParticipants(participantsResult.payload),
			services: asServices(servicesResult.payload),
			ticketTypes: asTicketTypes(ticketTypesResult.payload),
			ticketPurchases: asTicketPurchases(ticketPurchasesResult.payload),
			loadError
		};
	}
);
