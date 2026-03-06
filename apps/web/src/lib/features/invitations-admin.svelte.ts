import { authRpc, type InvitationPayload, type OrganizationInvitationRole } from '$lib/rpc-client';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';
import { readWindowScopedRouteContext } from './scoped-routing';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isInvitation = (value: unknown): value is InvitationPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.organizationId === 'string' && typeof value.email === 'string';

const asInvitations = (value: unknown): InvitationPayload[] =>
	Array.isArray(value) ? value.filter(isInvitation) : [];

const toRole = (value: string): OrganizationInvitationRole | null => {
	if (value === 'admin' || value === 'member') {
		return value;
	}
	return null;
};

export const loadAdminInvitations = async (organizationId?: string) => {
	const userResponse = await authRpc.listUserInvitations();
	const userPayload = await parseResponseBody(userResponse);
	const received = userResponse.ok ? asInvitations(userPayload) : [];

	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			sent: [] as InvitationPayload[],
			received,
			canManage: false
		};
	}

	const sentResponse = await authRpc.listInvitationsScoped(context);
	const sentPayload = await parseResponseBody(sentResponse);
	if (sentResponse.status === 403) {
		return { sent: [], received, canManage: false };
	}
	return {
		sent: sentResponse.ok ? asInvitations(sentPayload) : [],
		received,
		canManage: sentResponse.ok
	};
};

export const createAdminInvitation = async (input: {
	email: string;
	role: string;
	organizationId: string;
	resend?: boolean;
}) => {
	const role = toRole(input.role);
	if (!role) {
		return { ok: false, status: 422, message: 'ロールは admin / member を指定してください。' };
	}
	const context = readWindowScopedRouteContext();
	if (!context) {
		return { ok: false, status: 422, message: 'URL に組織/教室コンテキストがありません。' };
	}
	const response = await authRpc.createInvitationScoped(context, {
		email: input.email,
		role,
		organizationId: input.organizationId,
		resend: input.resend
	});
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? input.resend
				? '管理者招待を再送しました。'
				: '管理者招待を送信しました。'
			: toErrorMessage(payload, '管理者招待の作成に失敗しました。')
	};
};

export const actAdminInvitation = async (
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
	const messageByType = {
		accept: '管理者招待を承諾しました。',
		reject: '管理者招待を辞退しました。',
		cancel: '管理者招待を取り消しました。'
	} as const;
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok ? messageByType[type] : toErrorMessage(payload, '管理者招待の操作に失敗しました。')
	};
};
