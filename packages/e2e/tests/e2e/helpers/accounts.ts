import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { backendUrl } from './env';
import { expectOkJson } from './assertions';

/** E2E fixture account で共通利用する固定 password。 */
export const e2ePassword = 'password1234';

/**
 * Backend API と browser context の両方で使う E2E account fixture。
 */
export type TestAccount = {
  /** Sign-up / sign-in API に渡す email address。 */
  email: string;
  /** 画面表示や fixture 判別に使う account name。 */
  name: string;
  /** E2E account の password。 */
  password: string;
};

/**
 * API request context の cookie を browser context に同期する。
 *
 * API helper で sign-in 済みになった session を、以降の page 操作でも使える状態にする。
 *
 * @param request - 認証済み cookie を保持している Playwright API request context。
 * @param context - cookie を反映する browser context。
 */
export const syncRequestCookiesToBrowser = async (
  request: APIRequestContext,
  context: BrowserContext,
) => {
  const storageState = await request.storageState();
  await context.addCookies(storageState.cookies);
};

/**
 * 指定 account を backend の sign-up API で作成する。
 *
 * @param input - Sign-up に必要な request context と account fixture。
 * @param input.request - backend API を呼び出す Playwright request context。
 * @param input.account - 作成する E2E account。
 */
export const signUpAccount = async ({
  request,
  account,
}: {
  request: APIRequestContext;
  account: TestAccount;
}) => {
  const response = await request.post(`${backendUrl}/api/v1/auth/sign-up`, {
    data: {
      name: account.name,
      email: account.email,
      password: account.password,
    },
  });
  await expectOkJson(response, `sign up ${account.email}`);
};

/**
 * 指定 account で backend の sign-in API にログインする。
 *
 * @param input - Sign-in に必要な request context と account fixture。
 * @param input.request - backend API を呼び出す Playwright request context。
 * @param input.account - ログインに使う E2E account。
 */
export const signInAccount = async ({
  request,
  account,
}: {
  request: APIRequestContext;
  account: TestAccount;
}) => {
  const response = await request.post(`${backendUrl}/api/v1/auth/sign-in`, {
    data: {
      email: account.email,
      password: account.password,
    },
  });
  await expectOkJson(response, `sign in ${account.email}`);
};

/**
 * 一意な token と role label から E2E account fixture を組み立てる。
 *
 * @param token - test worker や test title から作った一意な識別子。
 * @param role - email と name に埋め込む role label。
 * @returns Sign-up / sign-in helper に渡せる account fixture。
 */
export const createAccount = (token: string, role: string): TestAccount => ({
  email: `${token}-${role}@example.com`,
  name: `${role} ${token}`,
  password: e2ePassword,
});
