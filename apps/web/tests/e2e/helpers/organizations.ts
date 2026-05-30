import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { createAccount, signUpAccount, syncRequestCookiesToBrowser } from './accounts';
import { expectOkJson, parseResponseBody } from './assertions';
import { backendUrl } from './env';

export type TestOrganization = {
	id: string;
	name: string;
	slug: string;
	storeId: string;
	storeSlug: string;
};

export type TestService = {
	id: string;
	name: string;
};

export type TestSlot = {
	id: string;
	startAt: string;
	endAt: string;
};

export type TestTicketType = {
	id: string;
	name: string;
	totalCount: number;
	expiresInDays?: number | null;
};

export type TestTicketPurchase = {
	id: string;
	ticketTypeId: string;
	participantId?: string;
};

export type TestInvitation = {
	id: string;
	email: string;
};

export type TestParticipant = {
	id: string;
	email: string;
	name: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

export const createOrganization = async ({
	request,
	name,
	slug
}: {
	request: APIRequestContext;
	name: string;
	slug: string;
}): Promise<TestOrganization> => {
	const response = await request.post(`${backendUrl}/api/v1/auth/organizations`, {
		data: {
			name,
			slug
		}
	});
	const payload = await expectOkJson(response, `create organization ${slug}`);
	const id = typeof payload.id === 'string' ? payload.id : null;
	expect(id, 'organization id should be returned').toBeTruthy();
	return {
		id: id as string,
		name,
		slug,
		storeId: id as string,
		storeSlug: slug
	};
};

export const updateStore = async ({
	request,
	organization,
	name,
	slug
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	name: string;
	slug: string;
}): Promise<TestOrganization> => {
	const response = await request.patch(
		`${backendUrl}/api/v1/auth/orgs/${encodeURIComponent(
			organization.slug
		)}/stores/${encodeURIComponent(organization.storeSlug)}`,
		{
			data: {
				name,
				slug
			}
		}
	);
	const payload = await expectOkJson(response, `update store ${organization.storeSlug}`);
	const id = typeof payload.id === 'string' ? payload.id : organization.storeId;
	const nextSlug = typeof payload.slug === 'string' ? payload.slug : slug;
	return {
		...organization,
		storeId: id,
		storeSlug: nextSlug
	};
};

export const createOwnerOrganization = async ({
	request,
	context,
	token,
	slug = token,
	storeSlug,
	storeName
}: {
	request: APIRequestContext;
	context?: BrowserContext;
	token: string;
	slug?: string;
	storeSlug?: string;
	storeName?: string;
}) => {
	const owner = createAccount(token, 'owner');
	await signUpAccount({ request, account: owner });
	let organization = await createOrganization({
		request,
		name: `E2E ${token}`,
		slug
	});
	if (
		(storeSlug && storeSlug !== organization.storeSlug) ||
		(storeName && storeName !== organization.name)
	) {
		organization = await updateStore({
			request,
			organization,
			name: storeName ?? `E2E ${token}`,
			slug: storeSlug ?? organization.storeSlug
		});
	}
	if (context) {
		await syncRequestCookiesToBrowser(request, context);
	}
	return { owner, organization };
};

export const createService = async ({
	request,
	organization,
	name,
	capacity = 3,
	kind = 'single',
	bookingPolicy = 'instant',
	durationMinutes = 60,
	bookingOpenMinutesBefore = 43_200,
	bookingCloseMinutesBefore = 0,
	cancellationDeadlineMinutes = 1_440,
	timezone = 'Asia/Tokyo',
	requiresTicket = false,
	isActive = true
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	name: string;
	capacity?: number;
	kind?: 'single' | 'recurring';
	bookingPolicy?: 'instant' | 'approval';
	durationMinutes?: number;
	bookingOpenMinutesBefore?: number;
	bookingCloseMinutesBefore?: number;
	cancellationDeadlineMinutes?: number;
	timezone?: string;
	requiresTicket?: boolean;
	isActive?: boolean;
}): Promise<TestService> => {
	const response = await request.post(`${backendUrl}/api/v1/auth/organizations/services`, {
		data: {
			organizationId: organization.id,
			storeId: organization.storeId,
			name,
			description: `${name} description`,
			kind,
			bookingPolicy,
			durationMinutes,
			capacity,
			bookingOpenMinutesBefore,
			bookingCloseMinutesBefore,
			cancellationDeadlineMinutes,
			timezone,
			requiresTicket,
			isActive
		}
	});
	const payload = await expectOkJson(response, `create service ${name}`);
	const id = typeof payload.id === 'string' ? payload.id : null;
	expect(id, 'service id should be returned').toBeTruthy();
	return { id: id as string, name };
};

export const futureSlotRange = (daysFromNow = 2) => {
	const start = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
	start.setUTCHours(1, 0, 0, 0);
	const end = new Date(start);
	end.setUTCHours(2, 0, 0, 0);
	return {
		startAt: start.toISOString(),
		endAt: end.toISOString(),
		dateInput: start.toISOString().slice(0, 10),
		startTime: '10:00',
		endTime: '11:00'
	};
};

export const createSlot = async ({
	request,
	organization,
	service,
	startAt,
	endAt,
	capacity = 3,
	staffLabel = 'E2E Staff',
	locationLabel = 'E2E Room'
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	service: TestService;
	startAt: string;
	endAt: string;
	capacity?: number;
	staffLabel?: string;
	locationLabel?: string;
}): Promise<TestSlot> => {
	const response = await request.post(`${backendUrl}/api/v1/auth/organizations/slots`, {
		data: {
			organizationId: organization.id,
			storeId: organization.storeId,
			serviceId: service.id,
			startAt,
			endAt,
			capacity,
			staffLabel,
			locationLabel
		}
	});
	const payload = await expectOkJson(response, `create slot for ${service.name}`);
	const id = typeof payload.id === 'string' ? payload.id : null;
	expect(id, 'slot id should be returned').toBeTruthy();
	return { id: id as string, startAt, endAt };
};

export const startPremiumTrial = async ({
	request,
	organization
}: {
	request: APIRequestContext;
	organization: TestOrganization;
}) => {
	const response = await request.post(`${backendUrl}/api/v1/auth/organizations/billing/trial`, {
		data: {
			organizationId: organization.id
		}
	});
	await expectOkJson(response, `start premium trial for ${organization.slug}`);
};

export const createOrganizationInvitation = async ({
	request,
	organization,
	email,
	role = 'member'
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	email: string;
	role?: 'admin' | 'member';
}) => {
	const response = await request.post(
		`${backendUrl}/api/v1/auth/orgs/${encodeURIComponent(organization.slug)}/invitations`,
		{
			data: {
				email,
				role
			}
		}
	);
	const payload = await expectOkJson(response, `create invitation for ${email}`);
	const id = typeof payload.id === 'string' ? payload.id : null;
	expect(id, 'invitation id should be returned').toBeTruthy();
	return { id: id as string };
};

export const createTicketType = async ({
	request,
	organization,
	name,
	totalCount = 10,
	expiresInDays,
	serviceScope = 'all',
	serviceIds = [],
	isActive = true,
	isForSale = true
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	name: string;
	totalCount?: number;
	expiresInDays?: number;
	serviceScope?: 'all' | 'specific';
	serviceIds?: string[];
	isActive?: boolean;
	isForSale?: boolean;
}): Promise<TestTicketType> => {
	const response = await request.post(`${backendUrl}/api/v1/auth/organizations/ticket-types`, {
		data: {
			organizationId: organization.id,
			storeId: organization.storeId,
			name,
			serviceScope,
			serviceIds,
			totalCount,
			expiresInDays,
			isActive,
			isForSale
		}
	});
	const payload = await expectOkJson(response, `create ticket type ${name}`);
	const id = typeof payload.id === 'string' ? payload.id : null;
	expect(id, 'ticket type id should be returned').toBeTruthy();
	return {
		id: id as string,
		name,
		totalCount,
		expiresInDays:
			typeof payload.expiresInDays === 'number' || payload.expiresInDays === null
				? payload.expiresInDays
				: expiresInDays
	};
};

export const findTicketTypeByName = async ({
	request,
	organization,
	name
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	name: string;
}): Promise<TestTicketType> => {
	const query = new URLSearchParams({
		organizationId: organization.id,
		storeId: organization.storeId
	});
	const response = await request.get(
		`${backendUrl}/api/v1/auth/organizations/ticket-types?${query.toString()}`
	);
	const payload = await parseResponseBody(response);
	expect(
		response.ok(),
		`list ticket types for ${organization.slug}: ${response.status()} ${JSON.stringify(payload)}`
	).toBe(true);
	expect(Array.isArray(payload), 'ticket type list should be returned').toBe(true);
	const record = (payload as unknown[]).map(asRecord).find((item) => item?.name === name) ?? null;
	expect(record, `ticket type ${name} should be returned`).toBeTruthy();
	const id = typeof record?.id === 'string' ? record.id : null;
	const totalCount = typeof record?.totalCount === 'number' ? record.totalCount : null;
	expect(id, 'ticket type id should be returned').toBeTruthy();
	expect(totalCount, 'ticket type total count should be returned').toBeTruthy();
	return {
		id: id as string,
		name,
		totalCount: totalCount as number,
		expiresInDays:
			typeof record?.expiresInDays === 'number' || record?.expiresInDays === null
				? record.expiresInDays
				: undefined
	};
};

export const createStoreInvitation = async ({
	request,
	organization,
	email,
	role = 'staff',
	resend = false
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	email: string;
	role?: 'manager' | 'staff';
	resend?: boolean;
}): Promise<TestInvitation> => {
	const response = await request.post(
		`${backendUrl}/api/v1/auth/orgs/${encodeURIComponent(
			organization.slug
		)}/stores/${encodeURIComponent(organization.storeSlug)}/invitations`,
		{
			data: {
				email,
				role,
				resend
			}
		}
	);
	const payload = await expectOkJson(response, `create store invitation for ${email}`);
	const id = typeof payload.id === 'string' ? payload.id : null;
	expect(id, 'store invitation id should be returned').toBeTruthy();
	return { id: id as string, email };
};

export const createParticipantInvitation = async ({
	request,
	organization,
	email,
	participantName,
	resend = false
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	email: string;
	participantName: string;
	resend?: boolean;
}): Promise<TestInvitation> => {
	const response = await request.post(
		`${backendUrl}/api/v1/auth/orgs/${encodeURIComponent(
			organization.slug
		)}/stores/${encodeURIComponent(organization.storeSlug)}/invitations`,
		{
			data: {
				email,
				role: 'participant',
				participantName,
				resend
			}
		}
	);
	const payload = await expectOkJson(response, `create participant invitation for ${email}`);
	const id = typeof payload.id === 'string' ? payload.id : null;
	expect(id, 'participant invitation id should be returned').toBeTruthy();
	return { id: id as string, email };
};

export const findStoreInvitationByEmail = async ({
	request,
	organization,
	email,
	subjectKind
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	email: string;
	subjectKind?: 'store_operator' | 'participant';
}): Promise<TestInvitation> => {
	const response = await request.get(
		`${backendUrl}/api/v1/auth/orgs/${encodeURIComponent(
			organization.slug
		)}/stores/${encodeURIComponent(organization.storeSlug)}/invitations`
	);
	const payload = await parseResponseBody(response);
	expect(
		response.ok(),
		`list store invitations for ${organization.slug}: ${response.status()} ${JSON.stringify(payload)}`
	).toBe(true);
	expect(Array.isArray(payload), 'store invitation list should be returned').toBe(true);
	const record =
		(payload as unknown[])
			.map(asRecord)
			.find(
				(item) =>
					item?.email === email && (!subjectKind || item.subjectKind === subjectKind)
			) ?? null;
	expect(record, `store invitation for ${email} should be returned`).toBeTruthy();
	const id = typeof record?.id === 'string' ? record.id : null;
	expect(id, 'store invitation id should be returned').toBeTruthy();
	return { id: id as string, email };
};

export const acceptInvitation = async ({
	request,
	invitation
}: {
	request: APIRequestContext;
	invitation: TestInvitation;
}) => {
	const response = await request.post(
		`${backendUrl}/api/v1/auth/invitations/${encodeURIComponent(invitation.id)}/accept`,
		{
			data: {}
		}
	);
	await expectOkJson(response, `accept invitation ${invitation.id}`);
};

export const selfEnrollParticipant = async ({
	request,
	organization
}: {
	request: APIRequestContext;
	organization: TestOrganization;
}): Promise<TestParticipant> => {
	const response = await request.post(
		`${backendUrl}/api/v1/auth/organizations/participants/self-enroll`,
		{
			data: {
				organizationId: organization.id,
				storeId: organization.storeId
			}
		}
	);
	const payload = await expectOkJson(response, `self-enroll participant for ${organization.slug}`);
	const participant = payload.participant;
	expect(
		typeof participant === 'object' && participant !== null,
		'participant payload should be returned'
	).toBe(true);
	const record = participant as Record<string, unknown>;
	const id = typeof record.id === 'string' ? record.id : null;
	const email = typeof record.email === 'string' ? record.email : null;
	const name = typeof record.name === 'string' ? record.name : null;
	expect(id, 'participant id should be returned').toBeTruthy();
	expect(email, 'participant email should be returned').toBeTruthy();
	expect(name, 'participant name should be returned').toBeTruthy();
	return { id: id as string, email: email as string, name: name as string };
};

export const createTicketPurchase = async ({
	request,
	organization,
	ticketType,
	paymentMethod = 'cash_on_site'
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	ticketType: TestTicketType;
	paymentMethod?: 'cash_on_site' | 'bank_transfer';
}): Promise<TestTicketPurchase> => {
	const response = await request.post(`${backendUrl}/api/v1/auth/organizations/ticket-purchases`, {
		data: {
			organizationId: organization.id,
			storeId: organization.storeId,
			ticketTypeId: ticketType.id,
			paymentMethod
		}
	});
	const payload = await expectOkJson(response, `create ticket purchase for ${ticketType.name}`);
	const id = typeof payload.id === 'string' ? payload.id : null;
	expect(id, 'ticket purchase id should be returned').toBeTruthy();
	return {
		id: id as string,
		ticketTypeId: ticketType.id,
		participantId: typeof payload.participantId === 'string' ? payload.participantId : undefined
	};
};

export const approveTicketPurchase = async ({
	request,
	organization,
	purchase
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	purchase: TestTicketPurchase;
}) => {
	const response = await request.post(
		`${backendUrl}/api/v1/auth/organizations/ticket-purchases/approve`,
		{
			data: {
				purchaseId: purchase.id,
				storeId: organization.storeId
			}
		}
	);
	await expectOkJson(response, `approve ticket purchase ${purchase.id}`);
};

export const expectNoScopedContextError = async (page: Page) => {
	await expect(page.getByText('URL に組織/店舗コンテキストがありません。')).toHaveCount(0);
	await expect(
		page.getByText('利用中の組織を `/admin/dashboard` で選択してください。')
	).toHaveCount(0);
};
