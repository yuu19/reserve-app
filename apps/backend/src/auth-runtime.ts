import { expo as expoPlugin } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins/organization';
import * as schema from './db/schema.js';
import { sendOrganizationInvitationEmail, type ResendEnv } from './email/resend.js';

export type AuthRuntimeEnv = {
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
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

export const createAuthRuntime = ({
  database,
  env,
}: {
  database: DrizzleDatabase;
  env: AuthRuntimeEnv;
}) => {
  const baseURL = env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const secret =
    env.BETTER_AUTH_SECRET ?? 'change-this-development-secret-to-at-least-32-characters';

  const authTrustedOrigins = parseCsv(env.BETTER_AUTH_TRUSTED_ORIGINS);
  if (authTrustedOrigins.length === 0) {
    authTrustedOrigins.push(baseURL, 'http://localhost:5173', 'mobile://');
  }

  if (!authTrustedOrigins.includes('mobile://')) {
    authTrustedOrigins.push('mobile://');
  }

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
    trustedOrigins: authTrustedOrigins,
    socialProviders,
    plugins: [
      organization({
        invitationExpiresIn: 172800,
        async sendInvitationEmail(data) {
          await sendOrganizationInvitationEmail({
            env,
            invitationId: data.id,
            inviteeEmail: data.email,
            inviterName: data.inviter.user.name,
            inviterEmail: data.inviter.user.email,
            organizationName: data.organization.name,
            role: data.role,
          });
        },
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
