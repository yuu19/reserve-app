import { expo as expoPlugin } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins/organization';
import * as schema from './infra/db/schema.js';
import type { ResendEnv } from './infra/email/resend.js';

/**
 * Worker と route factory が共有する環境変数。
 *
 * Better Auth、公開ページ、Stripe、E2E、OAuth、メール送信の設定をまとめ、
 * Cloudflare binding 固有の型は `BackendWorkerEnv` 側で拡張する。
 */
export type AuthRuntimeEnv = {
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
  BETTER_AUTH_COOKIE_DOMAIN?: string;
  INTERNAL_OPERATOR_EMAILS?: string;
  PUBLIC_EVENTS_ORG_SLUG?: string;
  PUBLIC_EVENTS_ORGANIZATION_SLUG?: string;
  PUBLIC_EVENTS_STORE_SLUG?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PREMIUM_MONTHLY_PRICE_ID?: string;
  STRIPE_PREMIUM_YEARLY_PRICE_ID?: string;
  STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED?: string;
  E2E_TESTING_ENABLED?: string;
  E2E_TEST_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
} & ResendEnv;

/**
 * 公開イベント用 organization slug を、現行名と旧 alias の両方から解決する。
 *
 * @param env - Backend runtime の環境変数。
 * @returns 設定済み slug。空文字または未設定の場合は `undefined`。
 */
export const resolvePublicEventsOrganizationSlug = (env: AuthRuntimeEnv): string | undefined =>
  env.PUBLIC_EVENTS_ORG_SLUG?.trim() || env.PUBLIC_EVENTS_ORGANIZATION_SLUG?.trim() || undefined;

/**
 * 公開イベント用 store slug を解決する。
 *
 * store slug が未設定の場合は、既存の単一店舗運用との互換性のため organization slug を fallback にする。
 *
 * @param env - Backend runtime の環境変数。
 * @returns 設定済み store slug または fallback slug。どちらも未設定の場合は `undefined`。
 */
export const resolvePublicEventsStoreSlug = (env: AuthRuntimeEnv): string | undefined =>
  env.PUBLIC_EVENTS_STORE_SLUG?.trim() || resolvePublicEventsOrganizationSlug(env);

type DrizzleDatabase = Parameters<typeof drizzleAdapter>[0];

/** Better Auth adapter と backend repositories が共有する Drizzle database 型。 */
export type AuthRuntimeDatabase = DrizzleDatabase;

const parseCsv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const toAbsoluteUrl = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  if (!candidate) {
    return undefined;
  }

  try {
    return new URL(candidate).toString();
  } catch {
    return undefined;
  }
};

/**
 * Hono route と Worker entrypoint が共有する Better Auth runtime を作成する。
 *
 * 返却する trusted origins は CORS にも使うため、mobile custom scheme、
 * localhost、本番 web origin をここで一元的に解決する。
 *
 * @param input - Better Auth runtime の依存。
 * @param input.database - Better Auth adapter と application route が共有する Drizzle database。
 * @param input.env - Better Auth、OAuth、Cookie、公開 page、Stripe、メールの環境変数。
 * @returns Better Auth instance、trusted origins、database、env をまとめた runtime。
 */
export const createAuthRuntime = ({
  database,
  env,
}: {
  database: DrizzleDatabase;
  env: AuthRuntimeEnv;
}) => {
  const baseURL = env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const useSecureCookies = (() => {
    try {
      return new URL(baseURL).protocol === 'https:';
    } catch {
      return false;
    }
  })();
  const secret =
    env.BETTER_AUTH_SECRET ?? 'change-this-development-secret-to-at-least-32-characters';

  const authTrustedOrigins = parseCsv(env.BETTER_AUTH_TRUSTED_ORIGINS);
  if (authTrustedOrigins.length === 0) {
    authTrustedOrigins.push(baseURL, 'http://localhost:5173', 'mobile://');
  }

  if (!authTrustedOrigins.includes('mobile://')) {
    authTrustedOrigins.push('mobile://');
  }

  const fallbackWebOrigin = authTrustedOrigins.find(
    (origin) => origin !== baseURL && !origin.startsWith('mobile://'),
  );
  const oauthErrorURL = toAbsoluteUrl(env.WEB_BASE_URL) ?? toAbsoluteUrl(fallbackWebOrigin);

  const cookieDomain = env.BETTER_AUTH_COOKIE_DOMAIN?.trim();
  const crossSubDomainCookiesEnabled = Boolean(
    cookieDomain && cookieDomain !== 'localhost' && !cookieDomain.startsWith('localhost:'),
  );

  const socialProviders =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: 'select_account' as const,
            accessType: 'offline' as const,
          },
        }
      : undefined;

  const auth = betterAuth({
    appName: 'better-auth-organization-demo',
    baseURL,
    secret,
    database: drizzleAdapter(database, {
      provider: 'sqlite',
      schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    account: {
      storeStateStrategy: 'cookie',
    },
    advanced: {
      useSecureCookies,
      // workers.dev や custom domain などの cross-origin frontend からも本番では
      // auth cookie を送れるようにする。ローカル HTTP では Lax のままにする。
      defaultCookieAttributes: {
        sameSite: useSecureCookies ? 'none' : 'lax',
      },
      ...(crossSubDomainCookiesEnabled
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: cookieDomain,
            },
          }
        : {}),
    },
    ...(oauthErrorURL
      ? {
          onAPIError: {
            errorURL: oauthErrorURL,
          },
        }
      : {}),
    trustedOrigins: authTrustedOrigins,
    socialProviders,
    plugins: [
      organization({
        invitationExpiresIn: 172800,
      }),
      expoPlugin(),
    ],
  });

  return {
    auth,
    authTrustedOrigins,
    database,
    env,
  };
};

/** Backend route が受け取る Better Auth instance の型。 */
export type AuthInstance = ReturnType<typeof createAuthRuntime>['auth'];
