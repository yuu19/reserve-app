import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { createAccount, signUpAccount, syncRequestCookiesToBrowser } from './accounts';
import { expectOkJson } from './assertions';
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
	capacity = 3
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	name: string;
	capacity?: number;
}): Promise<TestService> => {
	const response = await request.post(`${backendUrl}/api/v1/auth/organizations/services`, {
		data: {
			organizationId: organization.id,
			storeId: organization.storeId,
			name,
			description: `${name} description`,
			kind: 'single',
			bookingPolicy: 'instant',
			durationMinutes: 60,
			capacity,
			bookingOpenMinutesBefore: 43_200,
			bookingCloseMinutesBefore: 0,
			cancellationDeadlineMinutes: 1_440,
			timezone: 'Asia/Tokyo',
			requiresTicket: false,
			isActive: true
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
	endAt
}: {
	request: APIRequestContext;
	organization: TestOrganization;
	service: TestService;
	startAt: string;
	endAt: string;
}): Promise<TestSlot> => {
	const response = await request.post(`${backendUrl}/api/v1/auth/organizations/slots`, {
		data: {
			organizationId: organization.id,
			storeId: organization.storeId,
			serviceId: service.id,
			startAt,
			endAt,
			capacity: 3,
			staffLabel: 'E2E Staff',
			locationLabel: 'E2E Room'
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
