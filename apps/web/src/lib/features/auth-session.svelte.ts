import { getRemoteSession } from '$lib/remote/session.remote';
import { authRpc, type AuthSessionPayload, type OrganizationPayload } from '$lib/rpc-client';
import { readLastUsedOrganizationId, writeLastUsedOrganizationId } from './organization-preference';

export type JsonRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

const isOrganizationPayload = (value: unknown): value is OrganizationPayload =>
	isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.slug === 'string';

const asOrganizations = (value: unknown): OrganizationPayload[] =>
	Array.isArray(value) ? value.filter(isOrganizationPayload) : [];

export const asSessionPayload = (value: unknown): AuthSessionPayload => {
	if (value === null) {
		return null;
	}
	if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.session)) {
		return null;
	}
	return { user: value.user, session: value.session };
};

export const parseResponseBody = async (response: Response): Promise<unknown> => {
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

export const toErrorMessage = (payload: unknown, fallback: string): string => {
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

export const getNextPathFromSearch = (): string | null => {
	if (typeof window === 'undefined') {
		return null;
	}
	const searchParams = new URLSearchParams(window.location.search);
	const next = searchParams.get('next');
	if (!next || !next.startsWith('/')) {
		return null;
	}
	return next;
};

export const navigateToNextIfNeeded = (): boolean => {
	if (typeof window === 'undefined') {
		return false;
	}
	const next = getNextPathFromSearch();
	if (!next) {
		return false;
	}
	const url = new URL(next, 'http://localhost');
	window.location.assign(`${url.pathname}${url.search}${url.hash}`);
	return true;
};

export const redirectToLoginWithNext = (nextPath: string) => {
	if (typeof window === 'undefined') {
		return;
	}
	window.location.assign(`/?next=${encodeURIComponent(nextPath)}`);
};

export const getCurrentPathWithSearch = (): string => {
	if (typeof window === 'undefined') {
		return '/';
	}
	return `${window.location.pathname}${window.location.search}${window.location.hash}`;
};

export const loadSession = async (): Promise<{ session: AuthSessionPayload; status: number }> => {
	try {
		if (typeof window !== 'undefined') {
			const response = await authRpc.getSession();
			const payload = await parseResponseBody(response);
			if (!response.ok) {
				return { session: null, status: response.status };
			}
			return {
				session: asSessionPayload(payload),
				status: response.status
			};
		}
		return await getRemoteSession();
	} catch {
		return { session: null, status: 503 };
	}
};

export type PortalAccess = {
	canManage: boolean;
	canUseParticipantBooking: boolean;
	hasActiveOrganization: boolean;
};

const emptyPortalAccess = (): PortalAccess => ({
	canManage: false,
	canUseParticipantBooking: false,
	hasActiveOrganization: false
});

const readActiveOrganizationId = (payload: unknown): string | null => {
	if (!isRecord(payload) || typeof payload.id !== 'string') {
		return null;
	}
	return payload.id;
};

export const resolveLastUsedOrganizationId = (
	organizations: OrganizationPayload[],
	lastUsedOrganizationId: string | null
): string | null => {
	if (!lastUsedOrganizationId) {
		return null;
	}
	return organizations.some((organization) => organization.id === lastUsedOrganizationId)
		? lastUsedOrganizationId
		: null;
};

const activateLastUsedOrganizationIfNeeded = async (
	activeOrganizationId: string | null
): Promise<string | null> => {
	if (activeOrganizationId) {
		writeLastUsedOrganizationId(activeOrganizationId);
		return activeOrganizationId;
	}

	const listResponse = await authRpc.listOrganizations();
	const listPayload = await parseResponseBody(listResponse);
	if (!listResponse.ok) {
		return null;
	}

	const organizations = asOrganizations(listPayload);
	const targetOrganizationId = resolveLastUsedOrganizationId(
		organizations,
		readLastUsedOrganizationId()
	);
	if (!targetOrganizationId) {
		return null;
	}

	const activateResponse = await authRpc.setActiveOrganization({
		organizationId: targetOrganizationId
	});
	if (!activateResponse.ok) {
		return null;
	}

	writeLastUsedOrganizationId(targetOrganizationId);
	return targetOrganizationId;
};

export const loadPortalAccess = async (): Promise<PortalAccess> => {
	try {
		const organizationResponse = await authRpc.getFullOrganization();
		const organizationPayload = await parseResponseBody(organizationResponse);
		if (!organizationResponse.ok) {
			return emptyPortalAccess();
		}

		const activeOrganizationId = await activateLastUsedOrganizationIfNeeded(
			readActiveOrganizationId(organizationPayload)
		);
		if (!activeOrganizationId) {
			return emptyPortalAccess();
		}

		const [participantsResponse, participantInvitationResponse, myBookingsResponse] =
			await Promise.all([
				authRpc.listParticipants(activeOrganizationId),
				authRpc.listParticipantInvitations(activeOrganizationId),
				authRpc.listMyBookings({ organizationId: activeOrganizationId })
			]);

		return {
			canManage: participantsResponse.ok && participantInvitationResponse.ok,
			canUseParticipantBooking: myBookingsResponse.ok,
			hasActiveOrganization: true
		};
	} catch {
		return emptyPortalAccess();
	}
};

export const resolvePortalHomePath = (portalAccess: PortalAccess): '/admin/dashboard' | '/participant/home' =>
	portalAccess.canManage ? '/admin/dashboard' : '/participant/home';
