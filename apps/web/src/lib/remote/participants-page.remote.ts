import { env } from '$env/dynamic/public';
import { getRequestEvent, query } from '$app/server';
import type {
	ParticipantInvitationPayload,
	ParticipantPayload,
	ServicePayload,
	TicketPurchasePayload,
	TicketTypePayload
} from '$lib/rpc-client';

const defaultBackendUrl = 'http://localhost:3000';

type QueryValue = string | number | boolean | undefined;

type JsonRecord = Record<string, unknown>;

type ApiResult = {
	response: Response;
	payload: unknown;
};

type ParticipantsPageData = {
	activeOrganizationId: string | null;
	canManage: boolean;
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

const createApiUrl = (path: string, query: Record<string, QueryValue> = {}) => {
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

const isParticipant = (value: unknown): value is ParticipantPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.organizationId === 'string';

const isParticipantInvitation = (value: unknown): value is ParticipantInvitationPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.organizationId === 'string' &&
	typeof value.email === 'string';

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

const readActiveOrganizationId = (payload: unknown): string | null => {
	if (!isRecord(payload) || typeof payload.id !== 'string') {
		return null;
	}
	return payload.id;
};

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

const emptyParticipantsData = (): ParticipantsPageData => ({
	activeOrganizationId: null,
	canManage: false,
	participants: [],
	sentInvitations: [],
	receivedInvitations: [],
	services: [],
	ticketTypes: [],
	ticketPurchases: []
});

export const getParticipantsPageData = query(async (): Promise<ParticipantsPageData> => {
	const getApi = createApiGetter();

	const organizationResult = await getApi('/api/v1/auth/organizations/full');
	assertAllowedFailure(organizationResult, '利用中の組織情報の取得に失敗しました。');

	const activeOrganizationId = readActiveOrganizationId(organizationResult.payload);
	if (!activeOrganizationId) {
		return emptyParticipantsData();
	}

	const [
		participantsResult,
		sentInvitationsResult,
		receivedInvitationsResult,
		servicesResult,
		ticketTypesResult,
		ticketPurchasesResult
	] = await Promise.all([
		getApi('/api/v1/auth/organizations/participants', { organizationId: activeOrganizationId }),
		getApi('/api/v1/auth/organizations/participants/invitations', {
			organizationId: activeOrganizationId
		}),
		getApi('/api/v1/auth/organizations/participants/invitations/user'),
		getApi('/api/v1/auth/organizations/services', { organizationId: activeOrganizationId }),
		getApi('/api/v1/auth/organizations/ticket-types', { organizationId: activeOrganizationId }),
		getApi('/api/v1/auth/organizations/ticket-purchases', {
			organizationId: activeOrganizationId
		})
	]);

	assertAllowedFailure(participantsResult, '参加者情報の取得に失敗しました。', {
		allowForbidden: true
	});
	assertAllowedFailure(sentInvitationsResult, '参加者招待情報の取得に失敗しました。', {
		allowForbidden: true
	});
	assertAllowedFailure(receivedInvitationsResult, '受信した参加者招待の取得に失敗しました。');
	assertAllowedFailure(servicesResult, 'サービス情報の取得に失敗しました。', {
		allowForbidden: true
	});
	assertAllowedFailure(ticketTypesResult, '回数券種別の取得に失敗しました。', {
		allowForbidden: true
	});
	assertAllowedFailure(ticketPurchasesResult, '回数券購入申請の取得に失敗しました。', {
		allowForbidden: true
	});

	return {
		activeOrganizationId,
		canManage: participantsResult.response.ok && sentInvitationsResult.response.ok,
		participants: asParticipants(participantsResult.payload),
		sentInvitations: asParticipantInvitations(sentInvitationsResult.payload),
		receivedInvitations: asParticipantInvitations(receivedInvitationsResult.payload),
		services: asServices(servicesResult.payload),
		ticketTypes: asTicketTypes(ticketTypesResult.payload),
		ticketPurchases: asTicketPurchases(ticketPurchasesResult.payload)
	};
});
