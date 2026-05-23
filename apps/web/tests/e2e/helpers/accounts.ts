import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { backendUrl } from './env';
import { expectOkJson } from './assertions';

export const e2ePassword = 'password1234';

export type TestAccount = {
	email: string;
	name: string;
	password: string;
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
