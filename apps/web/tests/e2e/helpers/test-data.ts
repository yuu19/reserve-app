import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { APIRequestContext, APIResponse, BrowserContext, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';

const readGeneratedEnv = (): Record<string, string> => {
	const envFile = path.join(os.tmpdir(), 'reserve-app-web-e2e-env.json');
	try {
		const payload = JSON.parse(fs.readFileSync(envFile, 'utf8')) as Record<string, unknown>;
		return Object.fromEntries(
			Object.entries(payload).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
		);
	} catch {
		return {};
	}
};

const generatedEnv = readGeneratedEnv();

export const backendUrl = process.env.PUBLIC_BACKEND_URL?.trim() || 'http://localhost:3000';
export const publicEventsOrgSlug =
	process.env.PUBLIC_EVENTS_ORG_SLUG?.trim() ||
	generatedEnv.PUBLIC_EVENTS_ORG_SLUG?.trim() ||
	'public-events';
export const publicEventsClassroomSlug =
	process.env.PUBLIC_EVENTS_CLASSROOM_SLUG?.trim() ||
	generatedEnv.PUBLIC_EVENTS_CLASSROOM_SLUG?.trim() ||
	publicEventsOrgSlug;

export const e2ePassword = 'password1234';

type JsonRecord = Record<string, unknown>;

export type TestAccount = {
	email: string;
	name: string;
	password: string;
};

export type TestOrganization = {
	id: string;
	name: string;
	slug: string;
	classroomId: string;
	classroomSlug: string;
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

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null;

const sanitizeToken = (value: string): string =>
	(value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 34)
		.replace(/^-+|-+$/g, '') || 'e2e');

export const uniqueToken = (testInfo: TestInfo, prefix: string): string => {
	const title = sanitizeToken(testInfo.title);
	return sanitizeToken(`${prefix}-${testInfo.workerIndex}-${Date.now()}-${title}`);
};

export const parseResponseBody = async (response: APIResponse) => {
	const contentType = response.headers()['content-type'] ?? '';
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

export const expectOkJson = async <T extends JsonRecord>(
	response: APIResponse,
	message: string
): Promise<T> => {
	const payload = await parseResponseBody(response);
	expect(response.ok(), `${message}: ${response.status()} ${JSON.stringify(payload)}`).toBe(true);
	expect(isRecord(payload), `${message}: response should be an object`).toBe(true);
	return payload as T;
};

export const syncRequestCookiesToBrowser = async (
	request: APIRequestContext,
	context: BrowserContext
) => {
	const storageState = await request.storageState();
	await context.addCookies(storageState.cookies);
};

export const signUpAccount = async ({
	request,
	account
}: {
	request: APIRequestContext;
	account: TestAccount;
}) => {
	const response = await request.post(`${backendUrl}/api/v1/auth/sign-up`, {
		data: {
			name: account.name,
			email: account.email,
			password: account.password
		}
	});
	await expectOkJson(response, `sign up ${account.email}`);
};

export const signInAccount = async ({
	request,
	account
}: {
	request: APIRequestContext;
	account: TestAccount;
}) => {
	const response = await request.post(`${backendUrl}/api/v1/auth/sign-in`, {
		data: {
			email: account.email,
			password: account.password
		}
	});
	await expectOkJson(response, `sign in ${account.email}`);
};

export const createAccount = (token: string, role: string): TestAccount => ({
	email: `${token}-${role}@example.com`,
	name: `${role} ${token}`,
	password: e2ePassword
});

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
		classroomId: id as string,
		classroomSlug: slug
	};
};

export const updateClassroom = async ({
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
		)}/classrooms/${encodeURIComponent(organization.classroomSlug)}`,
		{
			data: {
				name,
				slug
			}
		}
	);
	const payload = await expectOkJson(response, `update classroom ${organization.classroomSlug}`);
	const id = typeof payload.id === 'string' ? payload.id : organization.classroomId;
	const nextSlug = typeof payload.slug === 'string' ? payload.slug : slug;
	return {
		...organization,
		classroomId: id,
		classroomSlug: nextSlug
	};
};

export const createOwnerOrganization = async ({
	request,
	context,
	token,
	slug = token,
	classroomSlug,
	classroomName
}: {
	request: APIRequestContext;
	context?: BrowserContext;
	token: string;
	slug?: string;
	classroomSlug?: string;
	classroomName?: string;
}) => {
	const owner = createAccount(token, 'owner');
	await signUpAccount({ request, account: owner });
	let organization = await createOrganization({
		request,
		name: `E2E ${token}`,
		slug
	});
	if (
		(classroomSlug && classroomSlug !== organization.classroomSlug) ||
		(classroomName && classroomName !== organization.name)
	) {
		organization = await updateClassroom({
			request,
			organization,
			name: classroomName ?? `E2E ${token}`,
			slug: classroomSlug ?? organization.classroomSlug
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
			classroomId: organization.classroomId,
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
			classroomId: organization.classroomId,
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
