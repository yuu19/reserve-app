import {
	authRpc,
	type ParticipantPayload,
	type ServicePayload,
	type TicketPackPayload,
	type TicketTypePayload
} from '$lib/rpc-client';
import dayjs from 'dayjs';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isParticipant = (value: unknown): value is ParticipantPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.organizationId === 'string';

const isService = (value: unknown): value is ServicePayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';

const isTicketType = (value: unknown): value is TicketTypePayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.organizationId === 'string' &&
	typeof value.name === 'string';

const isTicketPack = (value: unknown): value is TicketPackPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.organizationId === 'string' &&
	typeof value.ticketTypeId === 'string';

const asParticipants = (value: unknown): ParticipantPayload[] =>
	Array.isArray(value) ? value.filter(isParticipant) : [];

const asServices = (value: unknown): ServicePayload[] =>
	Array.isArray(value) ? value.filter(isService) : [];

const asTicketTypes = (value: unknown): TicketTypePayload[] =>
	Array.isArray(value) ? value.filter(isTicketType) : [];

const asTicketPacks = (value: unknown): TicketPackPayload[] =>
	Array.isArray(value) ? value.filter(isTicketPack) : [];

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

export const toTicketErrorMessage = (
	status: number,
	payload: unknown,
	fallback: string
): string => {
	if (status === 401) {
		return 'セッションの有効期限が切れました。再ログインしてください。';
	}
	if (status === 403) {
		return 'この操作には admin または owner 権限が必要です。';
	}
	const validationError = extractValidationErrorMessage(payload);
	if (validationError) {
		return validationError;
	}
	return toErrorMessage(payload, fallback);
};

export const toIsoFromDateTimeLocal = (value: string): string | undefined => {
	if (!value.trim()) {
		return undefined;
	}
	const parsed = dayjs(value);
	if (!parsed.isValid()) {
		return undefined;
	}
	return parsed.toISOString();
};

export const loadTicketManagementData = async (organizationId?: string) => {
	if (!organizationId) {
		return {
			participants: [] as ParticipantPayload[],
			services: [] as ServicePayload[],
			ticketTypes: [] as TicketTypePayload[],
			canManage: false,
			errors: [] as string[]
		};
	}

	const [participantResponse, serviceResponse, ticketTypeResponse] = await Promise.all([
		authRpc.listParticipants(organizationId),
		authRpc.listServices({ organizationId }),
		authRpc.listTicketTypes({ organizationId })
	]);

	const [participantPayload, servicePayload, ticketTypePayload] = await Promise.all([
		parseResponseBody(participantResponse),
		parseResponseBody(serviceResponse),
		parseResponseBody(ticketTypeResponse)
	]);

	const forbidden =
		participantResponse.status === 403 ||
		serviceResponse.status === 403 ||
		ticketTypeResponse.status === 403;
	if (forbidden) {
		return {
			participants: [] as ParticipantPayload[],
			services: [] as ServicePayload[],
			ticketTypes: [] as TicketTypePayload[],
			canManage: false,
			errors: [] as string[]
		};
	}

	return {
		participants: participantResponse.ok ? asParticipants(participantPayload) : [],
		services: serviceResponse.ok ? asServices(servicePayload) : [],
		ticketTypes: ticketTypeResponse.ok ? asTicketTypes(ticketTypePayload) : [],
		canManage: participantResponse.ok && serviceResponse.ok && ticketTypeResponse.ok,
		errors: [
			!participantResponse.ok
				? toTicketErrorMessage(
						participantResponse.status,
						participantPayload,
						'参加者情報の取得に失敗しました。'
					)
				: null,
			!serviceResponse.ok
				? toTicketErrorMessage(
						serviceResponse.status,
						servicePayload,
						'サービス情報の取得に失敗しました。'
					)
				: null,
			!ticketTypeResponse.ok
				? toTicketErrorMessage(
						ticketTypeResponse.status,
						ticketTypePayload,
						'回数券種別の取得に失敗しました。'
					)
				: null
		].filter((msg): msg is string => msg !== null)
	};
};

export const createTicketType = async (input: {
	organizationId: string;
	name: string;
	totalCount: number;
	expiresInDays?: number;
	serviceIds?: string[];
}) => {
	const response = await authRpc.createTicketType({
		organizationId: input.organizationId,
		name: input.name,
		totalCount: input.totalCount,
		expiresInDays: input.expiresInDays,
		serviceIds: input.serviceIds && input.serviceIds.length > 0 ? input.serviceIds : undefined
	});
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? '回数券種別を作成しました。'
			: toTicketErrorMessage(response.status, payload, '回数券種別の作成に失敗しました。')
	};
};

export const grantTicketPack = async (input: {
	organizationId: string;
	participantId: string;
	ticketTypeId: string;
	count?: number;
	expiresAt?: string;
}) => {
	const response = await authRpc.grantTicketPack({
		organizationId: input.organizationId,
		participantId: input.participantId,
		ticketTypeId: input.ticketTypeId,
		count: input.count,
		expiresAt: input.expiresAt
	});
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? '回数券を付与しました。'
			: toTicketErrorMessage(response.status, payload, '回数券付与に失敗しました。')
	};
};

export const loadMyTicketPacks = async (organizationId?: string) => {
	if (!organizationId) {
		return {
			packs: [] as TicketPackPayload[],
			ok: false,
			status: 422,
			error: 'organizationId is required.'
		};
	}

	const response = await authRpc.listMyTicketPacks(organizationId);
	const payload = await parseResponseBody(response);

	return {
		packs: response.ok ? asTicketPacks(payload) : [],
		ok: response.ok,
		status: response.status,
		error: response.ok
			? null
			: toTicketErrorMessage(response.status, payload, '回数券の取得に失敗しました。')
	};
};
