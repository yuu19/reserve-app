import { query } from '$app/server';
import type {
	ParticipantInvitationPayload,
	ParticipantPayload,
	ScopedApiContext,
	ServicePayload,
	TicketPurchasePayload,
	TicketTypePayload
} from '$lib/rpc-client';
import { readOrganizationPremiumRestriction } from '$lib/features/premium-restrictions';
import {
	buildScopedInvitationPath,
	createApiGetter,
	resolveScopedAccessContext,
	type ApiResult
} from '$lib/server/scoped-api';
import { z } from 'zod';

type JsonRecord = Record<string, unknown>;

type ParticipantsPageData = {
	activeContext: ScopedApiContext | null;
	organizationId: string | null;
	canManage: boolean;
	canManageParticipants: boolean;
	canManageClassroom: boolean;
	premiumRestriction: ReturnType<typeof readOrganizationPremiumRestriction>;
	participants: ParticipantPayload[];
	sentInvitations: ParticipantInvitationPayload[];
	receivedInvitations: ParticipantInvitationPayload[];
	services: ServicePayload[];
	ticketTypes: TicketTypePayload[];
	ticketPurchases: TicketPurchasePayload[];
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

const isParticipant = (value: unknown): value is ParticipantPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.organizationId === 'string';

const isParticipantInvitation = (value: unknown): value is ParticipantInvitationPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.organizationId === 'string' &&
	typeof value.email === 'string' &&
	value.subjectKind === 'participant';

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

const asParticipantInvitations = (value: unknown): ParticipantInvitationPayload[] =>
	Array.isArray(value) ? value.filter(isParticipantInvitation) : [];

const asServices = (value: unknown): ServicePayload[] =>
	Array.isArray(value) ? value.filter(isService) : [];

const asTicketTypes = (value: unknown): TicketTypePayload[] =>
	Array.isArray(value) ? value.filter(isTicketType) : [];

const asTicketPurchases = (value: unknown): TicketPurchasePayload[] =>
	Array.isArray(value) ? value.filter(isTicketPurchase) : [];

const assertAllowedFailure = (
	result: ApiResult,
	fallback: string,
	label: string,
	options: { allowForbidden?: boolean } = {}
) => {
	if (result.response.ok) {
		return;
	}
	if (options.allowForbidden && result.response.status === 403) {
		return;
	}
	const detail = toErrorMessage(result.payload, fallback);
	throw new Error(`${label} (${result.response.status}): ${detail}`);
};

const participantsPageQuerySchema = z.object({
	orgSlug: z.string().trim().min(1),
	classroomSlug: z.string().trim().min(1)
});

export const getParticipantsPageData = query(
	participantsPageQuerySchema,
	async ({ orgSlug, classroomSlug }): Promise<ParticipantsPageData> => {
		const getApi = createApiGetter();
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
				sentInvitations: [],
				receivedInvitations: [],
				services: [],
				ticketTypes: [],
				ticketPurchases: []
			};
		}

		const scopedQuery = {
			organizationId: scopedAccess.organizationId,
			classroomId: scopedAccess.classroomId
		};

		const [
			participantsResult,
			sentInvitationsResult,
			receivedInvitationsResult,
			servicesResult,
			ticketTypesResult,
			ticketPurchasesResult
		] = await Promise.all([
			getApi('/api/v1/auth/organizations/participants', scopedQuery),
			getApi(buildScopedInvitationPath(activeContext)),
			getApi('/api/v1/auth/invitations/user'),
			getApi('/api/v1/auth/organizations/services', scopedQuery),
			getApi('/api/v1/auth/organizations/ticket-types', scopedQuery),
			getApi('/api/v1/auth/organizations/ticket-purchases', scopedQuery)
		]);

		const debugResults = [
			['participants', participantsResult],
			['classroom invitations', sentInvitationsResult],
			['user invitations', receivedInvitationsResult],
			['services', servicesResult],
			['ticket types', ticketTypesResult],
			['ticket purchases', ticketPurchasesResult]
		] as const;
		for (const [label, result] of debugResults) {
			if (result.response.ok || result.response.status === 403) {
				continue;
			}
			console.error('getParticipantsPageData dependency failed', {
				label,
				status: result.response.status,
				payload: result.payload,
				orgSlug,
				classroomSlug
			});
		}

		const premiumRestriction =
			readOrganizationPremiumRestriction(participantsResult.payload) ??
			readOrganizationPremiumRestriction(sentInvitationsResult.payload) ??
			readOrganizationPremiumRestriction(servicesResult.payload) ??
			readOrganizationPremiumRestriction(ticketTypesResult.payload) ??
			readOrganizationPremiumRestriction(ticketPurchasesResult.payload);
		if (premiumRestriction) {
			return {
				activeContext,
				organizationId: scopedAccess.organizationId,
				canManage:
					scopedAccess.effective.canManageParticipants ||
					scopedAccess.effective.canManageClassroom,
				canManageParticipants: scopedAccess.effective.canManageParticipants,
				canManageClassroom: scopedAccess.effective.canManageClassroom,
				premiumRestriction,
				participants: [],
				sentInvitations: [],
				receivedInvitations: asParticipantInvitations(receivedInvitationsResult.payload),
				services: [],
				ticketTypes: [],
				ticketPurchases: []
			};
		}

		assertAllowedFailure(participantsResult, '参加者情報の取得に失敗しました。', 'participants', {
			allowForbidden: true
		});
		assertAllowedFailure(
			sentInvitationsResult,
			'参加者招待情報の取得に失敗しました。',
			'classroom invitations',
			{
			allowForbidden: true
			}
		);
		assertAllowedFailure(
			receivedInvitationsResult,
			'受信した参加者招待の取得に失敗しました。',
			'user invitations'
		);
		assertAllowedFailure(servicesResult, 'サービス情報の取得に失敗しました。', 'services', {
			allowForbidden: true
		});
		assertAllowedFailure(ticketTypesResult, '回数券種別の取得に失敗しました。', 'ticket types', {
			allowForbidden: true
		});
		assertAllowedFailure(
			ticketPurchasesResult,
			'回数券購入申請の取得に失敗しました。',
			'ticket purchases',
			{
			allowForbidden: true
			}
		);

		return {
			activeContext,
			organizationId: scopedAccess.organizationId,
			canManage:
				scopedAccess.effective.canManageParticipants ||
				scopedAccess.effective.canManageClassroom,
			canManageParticipants: scopedAccess.effective.canManageParticipants,
			canManageClassroom: scopedAccess.effective.canManageClassroom,
			premiumRestriction: null,
			participants: asParticipants(participantsResult.payload),
			sentInvitations: asParticipantInvitations(sentInvitationsResult.payload),
			receivedInvitations: asParticipantInvitations(receivedInvitationsResult.payload),
			services: asServices(servicesResult.payload),
			ticketTypes: asTicketTypes(ticketTypesResult.payload),
			ticketPurchases: asTicketPurchases(ticketPurchasesResult.payload)
		};
	}
);
