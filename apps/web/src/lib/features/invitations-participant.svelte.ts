import {
	authRpc,
	type ParticipantInvitationPayload,
	type ParticipantPayload
} from '$lib/rpc-client';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';
import { readWindowScopedRouteContext } from './scoped-routing';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

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

export const loadParticipantFeatureData = async (_organizationId?: string) => {
	const userResponse = await authRpc.listUserParticipantInvitations();
	const userPayload = await parseResponseBody(userResponse);
	const received = userResponse.ok ? asParticipantInvitations(userPayload) : [];

	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			participants: [] as ParticipantPayload[],
			sent: [] as ParticipantInvitationPayload[],
			received,
			canManage: false
		};
	}

	const [participantResponse, invitationResponse] = await Promise.all([
		authRpc.listParticipantsScoped(context),
		authRpc.listParticipantInvitationsScoped(context)
	]);
	const [participantPayload, invitationPayload] = await Promise.all([
		parseResponseBody(participantResponse),
		parseResponseBody(invitationResponse)
	]);

	const forbidden = participantResponse.status === 403 || invitationResponse.status === 403;
	if (forbidden) {
		return {
			participants: [] as ParticipantPayload[],
			sent: [] as ParticipantInvitationPayload[],
			received,
			canManage: false
		};
	}

	return {
		participants: participantResponse.ok ? asParticipants(participantPayload) : [],
		sent: invitationResponse.ok ? asParticipantInvitations(invitationPayload) : [],
		received,
		canManage: participantResponse.ok && invitationResponse.ok
	};
};

export const createParticipantInvitation = async (input: {
	email: string;
	participantName: string;
	organizationId: string;
	resend?: boolean;
}) => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		return { ok: false, status: 422, message: 'URL に組織/教室コンテキストがありません。' };
	}
	const response = await authRpc.createParticipantInvitationScoped(context, input);
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? input.resend
				? '参加者招待を再送しました。'
				: '参加者招待を送信しました。'
			: toErrorMessage(payload, '参加者招待の作成に失敗しました。')
	};
};

export const actParticipantInvitation = async (
	type: 'accept' | 'reject' | 'cancel',
	invitationId: string
) => {
	const response =
		type === 'accept'
			? await authRpc.acceptParticipantInvitation({ invitationId })
			: type === 'reject'
				? await authRpc.rejectParticipantInvitation({ invitationId })
				: await authRpc.cancelParticipantInvitation({ invitationId });
	const payload = await parseResponseBody(response);
	const messageByType = {
		accept: '参加者招待を承諾しました。',
		reject: '参加者招待を辞退しました。',
		cancel: '参加者招待を取り消しました。'
	} as const;
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok ? messageByType[type] : toErrorMessage(payload, '参加者招待の操作に失敗しました。')
	};
};
