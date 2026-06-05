import { query } from '$app/server';
import type {
	ParticipantInvitationPayload,
	ParticipantPayload,
	ScopedApiContext
} from '$lib/rpc-client';
import { readOrganizationPremiumRestriction } from '$lib/features/premium-restrictions';
import {
	buildScopedAuthPath,
	buildScopedInvitationPath,
	createApiGetter,
	resolveScopedAccessContext,
	type ApiResult,
	type QueryValue
} from '$lib/server/scoped-api';
import { z } from 'zod';

type JsonRecord = Record<string, unknown>;

type ParticipantsPageData = {
	activeContext: ScopedApiContext | null;
	organizationId: string | null;
	canManage: boolean;
	canManageParticipants: boolean;
	canManageStore: boolean;
	premiumRestriction: ReturnType<typeof readOrganizationPremiumRestriction>;
	participants: ParticipantPayload[];
	sentInvitations: ParticipantInvitationPayload[];
	receivedInvitations: ParticipantInvitationPayload[];
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

const isParticipantInvitation = (value: unknown): value is ParticipantInvitationPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.organizationId === 'string' &&
	typeof value.email === 'string' &&
	value.subjectKind === 'participant';

const asParticipants = (value: unknown): ParticipantPayload[] =>
	Array.isArray(value) ? value.filter(isParticipant) : [];

const asParticipantInvitations = (value: unknown): ParticipantInvitationPayload[] =>
	Array.isArray(value) ? value.filter(isParticipantInvitation) : [];

const createFailedApiResult = (message: string): ApiResult => ({
	response: new Response(JSON.stringify({ message }), {
		status: 503,
		headers: { 'content-type': 'application/json' }
	}),
	payload: { message }
});

const createSafeApiGetter =
	(getApi: ReturnType<typeof createApiGetter>) =>
	async (path: string, query?: Record<string, QueryValue>): Promise<ApiResult> => {
		try {
			return await getApi(path, query);
		} catch (error) {
			const message = toExceptionMessage(error, 'API リクエストに失敗しました。');
			console.error('getParticipantsPageData request failed', { path, query, message });
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
		? '一部の参加者データを取得できませんでした。時間をおいて再読み込みしてください。'
		: null;

const participantsPageQuerySchema = z.object({
	orgSlug: z.string().trim().min(1),
	storeSlug: z.string().trim().min(1)
});

export const getParticipantsPageData = query(
	participantsPageQuerySchema,
	async ({ orgSlug, storeSlug }): Promise<ParticipantsPageData> => {
		const getApi = createSafeApiGetter(createApiGetter());
		const activeContext: ScopedApiContext = { orgSlug, storeSlug };
		const scopedAccess = await resolveScopedAccessContext(getApi, activeContext);
		if (!scopedAccess) {
			return {
				activeContext: null,
				organizationId: null,
				canManage: false,
				canManageParticipants: false,
				canManageStore: false,
				premiumRestriction: null,
				participants: [],
				sentInvitations: [],
				receivedInvitations: [],
				loadError: null
			};
		}

		const [participantsResult, sentInvitationsResult, receivedInvitationsResult] =
			await Promise.all([
				getApi(buildScopedAuthPath(activeContext, '/participants')),
				getApi(buildScopedInvitationPath(activeContext)),
				getApi('/api/v1/auth/invitations/user')
			]);

		const debugResults = [
			['participants', participantsResult],
			['store invitations', sentInvitationsResult],
			['user invitations', receivedInvitationsResult]
		] as const;
		for (const [label, result] of debugResults) {
			if (result.response.ok || result.response.status === 403) {
				continue;
			}
			console.error('getParticipantsPageData dependency failed', {
				label,
				status: result.response.status,
				detail: toErrorMessage(result.payload, '参加者ページ依存データの取得に失敗しました。'),
				orgSlug,
				storeSlug
			});
		}

		const premiumRestriction =
			readOrganizationPremiumRestriction(participantsResult.payload) ??
			readOrganizationPremiumRestriction(sentInvitationsResult.payload);
		if (premiumRestriction) {
			return {
				activeContext,
				organizationId: scopedAccess.organizationId,
				canManage:
					scopedAccess.effective.canManageParticipants || scopedAccess.effective.canManageStore,
				canManageParticipants: scopedAccess.effective.canManageParticipants,
				canManageStore: scopedAccess.effective.canManageStore,
				premiumRestriction,
				participants: [],
				sentInvitations: [],
				receivedInvitations: asParticipantInvitations(receivedInvitationsResult.payload),
				loadError: createLoadError([
					getDependencyFailureMessage(
						receivedInvitationsResult,
						'受信した参加者招待の取得に失敗しました。'
					)
				])
			};
		}

		const loadError = createLoadError([
			getDependencyFailureMessage(participantsResult, '参加者情報の取得に失敗しました。', {
				allowForbidden: true
			}),
			getDependencyFailureMessage(sentInvitationsResult, '参加者招待情報の取得に失敗しました。', {
				allowForbidden: true
			}),
			getDependencyFailureMessage(
				receivedInvitationsResult,
				'受信した参加者招待の取得に失敗しました。'
			)
		]);

		return {
			activeContext,
			organizationId: scopedAccess.organizationId,
			canManage:
				scopedAccess.effective.canManageParticipants || scopedAccess.effective.canManageStore,
			canManageParticipants: scopedAccess.effective.canManageParticipants,
			canManageStore: scopedAccess.effective.canManageStore,
			premiumRestriction: null,
			participants: asParticipants(participantsResult.payload),
			sentInvitations: asParticipantInvitations(sentInvitationsResult.payload),
			receivedInvitations: asParticipantInvitations(receivedInvitationsResult.payload),
			loadError
		};
	}
);
