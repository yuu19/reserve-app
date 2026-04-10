import {
	authRpc,
	type ClassroomInvitationRole,
	type InvitationPayload
} from '$lib/rpc-client';
import { loadOrganizations } from './organization-context.svelte';
import {
	parseResponseBody,
	toErrorMessage
} from './auth-session.svelte';
import { readOrganizationPremiumRestriction } from './premium-restrictions';
import { readWindowScopedRouteContext } from './scoped-routing';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isInvitation = (value: unknown): value is InvitationPayload =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.organizationId === 'string' &&
	typeof value.organizationSlug === 'string' &&
	typeof value.email === 'string' &&
	typeof value.subjectKind === 'string';

const asInvitations = (value: unknown): InvitationPayload[] =>
	Array.isArray(value) ? value.filter(isInvitation) : [];

const isClassroomRole = (value: string): value is ClassroomInvitationRole =>
	value === 'manager' || value === 'staff' || value === 'participant';

const isOperatorInvitation = (invitation: InvitationPayload): boolean =>
	invitation.subjectKind === 'org_operator' || invitation.subjectKind === 'classroom_operator';

export const loadClassroomInvitations = async () => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			organizationId: null as string | null,
			operatorInvitations: [] as InvitationPayload[],
			participantInvitations: [] as InvitationPayload[],
			canManageClassroom: false,
			canManageParticipants: false,
			premiumRestriction: null
		};
	}

	const [{ activeOrganization, activeClassroom }, invitationResponse] = await Promise.all([
		loadOrganizations(context),
		authRpc.listInvitationsScoped(context)
	]);
	const invitationPayload = await parseResponseBody(invitationResponse);
	const premiumRestriction = readOrganizationPremiumRestriction(invitationPayload);
	const visibleInvitations = invitationResponse.ok ? asInvitations(invitationPayload) : [];

	return {
		organizationId: activeOrganization?.id ?? null,
		operatorInvitations: visibleInvitations.filter(
			(invitation) => invitation.subjectKind === 'classroom_operator'
		),
		participantInvitations: visibleInvitations.filter(
			(invitation) => invitation.subjectKind === 'participant'
		),
		canManageClassroom: activeClassroom?.canManageClassroom ?? false,
		canManageParticipants: activeClassroom?.canManageParticipants ?? false,
		premiumRestriction
	};
};

export const loadReceivedOperatorInvitations = async () => {
	const response = await authRpc.listUserInvitations();
	const payload = await parseResponseBody(response);
	return {
		received: response.ok ? asInvitations(payload).filter(isOperatorInvitation) : []
	};
};

export const createClassroomInvitation = async (input: {
	email: string;
	role: string;
	participantName?: string;
	resend?: boolean;
}) => {
	if (!isClassroomRole(input.role)) {
		return {
			ok: false,
			status: 422,
			message: 'ロールは manager / staff / participant を指定してください。'
		};
	}
	if (input.role === 'participant' && !input.participantName?.trim()) {
		return {
			ok: false,
			status: 422,
			message: '参加者招待には参加者名が必要です。'
		};
	}

	const context = readWindowScopedRouteContext();
	if (!context) {
		return { ok: false, status: 422, message: 'URL に組織/教室コンテキストがありません。' };
	}

	const response = await authRpc.createInvitationScoped(context, {
		email: input.email,
		role: input.role,
		participantName: input.role === 'participant' ? input.participantName?.trim() : undefined,
		resend: input.resend
	});
	const payload = await parseResponseBody(response);
	const invitationLabel = input.role === 'participant' ? '参加者招待' : '教室運営招待';
	const premiumRestriction = readOrganizationPremiumRestriction(payload);

	return {
		ok: response.ok,
		status: response.status,
		premiumRestriction,
		message: response.ok
			? input.resend
				? `${invitationLabel}を再送しました。`
				: `${invitationLabel}を送信しました。`
			: premiumRestriction
				? 'この機能は組織のPremiumプランで利用できます。'
				: toErrorMessage(payload, `${invitationLabel}の作成に失敗しました。`)
	};
};

export const actOperatorInvitation = async (
	type: 'accept' | 'reject' | 'cancel',
	invitationId: string
) => {
	const response =
		type === 'accept'
			? await authRpc.acceptInvitation({ invitationId })
			: type === 'reject'
				? await authRpc.rejectInvitation({ invitationId })
				: await authRpc.cancelInvitation({ invitationId });
	const payload = await parseResponseBody(response);
	const premiumRestriction = readOrganizationPremiumRestriction(payload);
	const messageByType = {
		accept: '運営招待を承諾しました。',
		reject: '運営招待を辞退しました。',
		cancel: '招待を取り消しました。'
	} as const;

	return {
		ok: response.ok,
		status: response.status,
		premiumRestriction,
		message: response.ok
			? messageByType[type]
			: premiumRestriction
				? 'この機能は組織のPremiumプランで利用できます。'
				: toErrorMessage(payload, '招待の操作に失敗しました。')
	};
};
