import {
	authRpc,
	type ParticipantPayload,
	type ServicePayload,
	type TicketPackPayload,
	type TicketPurchasePayload,
	type TicketTypePayload
} from '$lib/rpc-client';
import dayjs from 'dayjs';
import { parseResponseBody, toErrorMessage } from './auth-session.svelte';
import { readWindowScopedRouteContext } from './scoped-routing';

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

const asTicketPacks = (value: unknown): TicketPackPayload[] =>
	Array.isArray(value) ? value.filter(isTicketPack) : [];

const asTicketPurchases = (value: unknown): TicketPurchasePayload[] =>
	Array.isArray(value) ? value.filter(isTicketPurchase) : [];

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
	const message = isRecord(payload) && typeof payload.message === 'string' ? payload.message : null;
	if (status === 401) {
		return 'セッションの有効期限が切れました。再ログインしてください。';
	}
	if (status === 403) {
		return 'この操作を実行する権限がありません。';
	}
	if (status === 404) {
		if (message === 'Ticket purchase not found.') {
			return '回数券購入申請が見つかりません。';
		}
		if (message === 'Ticket type not found.') {
			return '回数券種別が見つかりません。';
		}
	}
	if (status === 409) {
		if (message === 'Ticket type is not purchasable.') {
			return 'この回数券種別は現在購入できません。';
		}
		if (message === 'Only pending approval purchase can be approved.') {
			return '承認できるのは承認待ち申請のみです。';
		}
		if (message === 'Only pending approval purchase can be rejected.') {
			return '却下できるのは承認待ち申請のみです。';
		}
		if (message === 'Purchase cannot be canceled.') {
			return 'この購入申請は取り下げできません。';
		}
	}
	if (status === 422) {
		if (message === 'Stripe is not configured.') {
			return 'Stripe 設定が未完了のため決済を開始できません。';
		}
		if (message === 'stripePriceId is not configured for ticket type.') {
			return 'この券種には Stripe 価格IDが設定されていません。';
		}
		if (message === 'stripePriceId is required when isForSale is true.') {
			return '販売対象にする場合は Stripe 価格IDが必要です。';
		}
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

export const loadTicketManagementData = async (_organizationId?: string) => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			participants: [] as ParticipantPayload[],
			services: [] as ServicePayload[],
			ticketTypes: [] as TicketTypePayload[],
			canManage: false,
			errors: [] as string[]
		};
	}

	const [participantResponse, serviceResponse, ticketTypeResponse] = await Promise.all([
		authRpc.listParticipantsScoped(context),
		authRpc.listServicesScoped(context),
		authRpc.listTicketTypesScoped(context)
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
	isForSale?: boolean;
	stripePriceId?: string;
}) => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			ok: false,
			status: 422,
			message: 'URL に組織/教室コンテキストがありません。'
		};
	}
	const response = await authRpc.createTicketTypeScoped(context, {
		organizationId: input.organizationId,
		name: input.name,
		totalCount: input.totalCount,
		expiresInDays: input.expiresInDays,
		serviceIds: input.serviceIds && input.serviceIds.length > 0 ? input.serviceIds : undefined,
		isForSale: input.isForSale,
		stripePriceId: input.stripePriceId
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
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			ok: false,
			status: 422,
			message: 'URL に組織/教室コンテキストがありません。'
		};
	}
	const response = await authRpc.grantTicketPackScoped(context, {
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

export const loadMyTicketPacks = async (_organizationId?: string) => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			packs: [] as TicketPackPayload[],
			ok: false,
			status: 422,
			error: 'organizationId is required.'
		};
	}

	const response = await authRpc.listMyTicketPacksScoped(context);
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

export const loadPurchasableTicketTypes = async (_organizationId?: string) => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			ticketTypes: [] as TicketTypePayload[],
			ok: false,
			status: 422,
			error: 'organizationId is required.'
		};
	}

	const response = await authRpc.listPurchasableTicketTypesScoped(context);
	const payload = await parseResponseBody(response);
	return {
		ticketTypes: response.ok ? asTicketTypes(payload) : [],
		ok: response.ok,
		status: response.status,
		error: response.ok
			? null
			: toTicketErrorMessage(response.status, payload, '購入可能回数券の取得に失敗しました。')
	};
};

export const createTicketPurchase = async (input: {
	organizationId: string;
	ticketTypeId: string;
	paymentMethod: 'stripe' | 'cash_on_site' | 'bank_transfer';
}) => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			ok: false,
			status: 422,
			purchase: null,
			checkoutUrl: null,
			message: 'URL に組織/教室コンテキストがありません。'
		};
	}
	const response = await authRpc.createTicketPurchaseScoped(context, {
		organizationId: input.organizationId,
		ticketTypeId: input.ticketTypeId,
		paymentMethod: input.paymentMethod
	});
	const payload = await parseResponseBody(response);
	const checkoutUrl =
		isRecord(payload) && typeof payload.checkoutUrl === 'string' ? payload.checkoutUrl : null;
	const purchase =
		isRecord(payload) && typeof payload.id === 'string'
			? (payload as unknown as TicketPurchasePayload)
			: null;
	return {
		ok: response.ok,
		status: response.status,
		purchase,
		checkoutUrl,
		message: response.ok
			? input.paymentMethod === 'stripe'
				? 'Stripe決済画面へ移動します。'
				: '回数券購入申請を受け付けました。'
			: toTicketErrorMessage(response.status, payload, '回数券購入申請に失敗しました。')
	};
};

export const loadMyTicketPurchases = async (_organizationId?: string) => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			purchases: [] as TicketPurchasePayload[],
			ok: false,
			status: 422,
			error: 'organizationId is required.'
		};
	}

	const response = await authRpc.listMyTicketPurchasesScoped(context);
	const payload = await parseResponseBody(response);
	return {
		purchases: response.ok ? asTicketPurchases(payload) : [],
		ok: response.ok,
		status: response.status,
		error: response.ok
			? null
			: toTicketErrorMessage(response.status, payload, '回数券購入申請の取得に失敗しました。')
	};
};

export const loadTicketPurchases = async (input: {
	organizationId?: string;
	participantId?: string;
	paymentMethod?: 'stripe' | 'cash_on_site' | 'bank_transfer';
	status?: 'pending_payment' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled_by_participant';
}) => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			purchases: [] as TicketPurchasePayload[],
			ok: false,
			status: 422,
			error: 'URL に組織/教室コンテキストがありません。'
		};
	}
	const response = await authRpc.listTicketPurchasesScoped(context, input);
	const payload = await parseResponseBody(response);
	return {
		purchases: response.ok ? asTicketPurchases(payload) : [],
		ok: response.ok,
		status: response.status,
		error: response.ok
			? null
			: toTicketErrorMessage(response.status, payload, '回数券購入申請の取得に失敗しました。')
	};
};

export const approveTicketPurchase = async (purchaseId: string) => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			ok: false,
			status: 422,
			message: 'URL に組織/教室コンテキストがありません。'
		};
	}
	const response = await authRpc.approveTicketPurchaseScoped(context, { purchaseId });
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? '回数券購入申請を承認しました。'
			: toTicketErrorMessage(response.status, payload, '回数券購入申請の承認に失敗しました。')
	};
};

export const rejectTicketPurchase = async (purchaseId: string, reason?: string) => {
	const normalizedReason = reason?.trim() ? reason.trim() : undefined;
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			ok: false,
			status: 422,
			message: 'URL に組織/教室コンテキストがありません。'
		};
	}
	const response = await authRpc.rejectTicketPurchaseScoped(context, {
		purchaseId,
		reason: normalizedReason
	});
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? '回数券購入申請を却下しました。'
			: toTicketErrorMessage(response.status, payload, '回数券購入申請の却下に失敗しました。')
	};
};

export const cancelTicketPurchase = async (purchaseId: string) => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		return {
			ok: false,
			status: 422,
			message: 'URL に組織/教室コンテキストがありません。'
		};
	}
	const response = await authRpc.cancelTicketPurchaseScoped(context, { purchaseId });
	const payload = await parseResponseBody(response);
	return {
		ok: response.ok,
		status: response.status,
		message: response.ok
			? '回数券購入申請を取り下げました。'
			: toTicketErrorMessage(response.status, payload, '回数券購入申請の取り下げに失敗しました。')
	};
};
