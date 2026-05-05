import { expo as expoPlugin } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins/organization';
import * as schema from './db/schema.js';
import type { ResendEnv } from './email/resend.js';

export type AuthRuntimeEnv = {
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
  BETTER_AUTH_COOKIE_DOMAIN?: string;
  INTERNAL_OPERATOR_EMAILS?: string;
  PUBLIC_EVENTS_ORG_SLUG?: string;
  PUBLIC_EVENTS_CLASSROOM_SLUG?: string;
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

type DrizzleDatabase = Parameters<typeof drizzleAdapter>[0];
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
      // Allow cross-origin frontend origins (e.g. workers.dev / localhost) to
      // send auth cookies in production. Local HTTP keeps Lax.
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

export type AuthInstance = ReturnType<typeof createAuthRuntime>['auth'];
