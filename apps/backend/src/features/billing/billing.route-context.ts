import type { BillingProvider } from '@repo/saas-billing-core';
import { and, eq } from 'drizzle-orm';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import type { OrganizationRole } from '../../domain/booking/authorization.js';
import * as dbSchema from '../../infra/db/schema.js';
import type { BillingOperationStore } from './billing-operation.store.js';
import type { ReserveAppBillingStore } from './billing.store.js';

export type BillingRouteBindings = {
  Variables: {
    user: Record<string, unknown> | null;
    session: Record<string, unknown> | null;
  };
};

export type BillingIdentity = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  activeOrganizationId: string | null;
};

export type BillingOrganizationSubject = {
  id: string;
  name: string;
  slug: string;
};

export type BillingProviderFactory = (input: {
  env: AuthRuntimeEnv;
  testClockId?: string | null;
}) => BillingProvider;

export type BillingRouteContext = {
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  store: ReserveAppBillingStore;
  operationStore: BillingOperationStore;
  createProvider: BillingProviderFactory;
  getSessionIdentity(headers: Headers): Promise<BillingIdentity | null>;
  resolveOrganizationId(input: {
    requestedOrganizationId?: string;
    activeOrganizationId: string | null;
  }): string | null;
  readOrganizationMembershipRole(input: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationRole>;
  readOrganizationSubject(input: {
    organizationId: string;
  }): Promise<BillingOrganizationSubject | null>;
  resolveE2eStripeTestClockId(headers: Headers): string | null;
};

type CreateBillingRouteContextInput = {
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  store: ReserveAppBillingStore;
  operationStore: BillingOperationStore;
  createProvider: BillingProviderFactory;
};

/** E2E 実行時だけ、共有 secret 付き header から Stripe test clock id を受け取る。 */
export const resolveE2eStripeTestClockId = ({
  env,
  headers,
}: {
  env: { E2E_TESTING_ENABLED?: string; E2E_TEST_SECRET?: string };
  headers: Headers;
}): string | null => {
  if (env.E2E_TESTING_ENABLED !== 'true') {
    return null;
  }

  const expectedSecret = env.E2E_TEST_SECRET?.trim();
  if (!expectedSecret) {
    return null;
  }

  const receivedSecret = headers.get('x-e2e-test-secret')?.trim();
  if (receivedSecret !== expectedSecret) {
    return null;
  }

  const testClockId = headers.get('x-e2e-stripe-test-clock-id')?.trim();
  return testClockId?.startsWith('clock_') ? testClockId : null;
};

const getActiveOrganizationId = (session: unknown): string | null => {
  if (typeof session !== 'object' || session === null) {
    return null;
  }

  const currentSession = session as Record<string, unknown>;
  const activeOrganizationId = currentSession.activeOrganizationId;
  return typeof activeOrganizationId === 'string' ? activeOrganizationId : null;
};

const getStringValue = (value: unknown): string | null => {
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

export const createBillingRouteContext = ({
  auth,
  database,
  env,
  store,
  operationStore,
  createProvider,
}: CreateBillingRouteContextInput): BillingRouteContext => ({
  auth,
  database,
  env,
  store,
  operationStore,
  createProvider,

  async getSessionIdentity(headers) {
    const session = await auth.api.getSession({ headers });
    const userId = getStringValue(session?.user?.id);
    if (!userId) {
      return null;
    }

    const userEmail = getStringValue(session?.user?.email);
    return {
      userId,
      email: userEmail ? normalizeEmail(userEmail) : null,
      emailVerified: session?.user?.emailVerified === true,
      activeOrganizationId: getActiveOrganizationId(session?.session),
    };
  },

  resolveOrganizationId({ requestedOrganizationId, activeOrganizationId }) {
    return requestedOrganizationId ?? activeOrganizationId;
  },

  async readOrganizationMembershipRole({ organizationId, userId }) {
    const rows = await database
      .select({
        role: dbSchema.member.role,
      })
      .from(dbSchema.member)
      .where(
        and(eq(dbSchema.member.organizationId, organizationId), eq(dbSchema.member.userId, userId)),
      )
      .limit(1);

    const role = rows[0]?.role;
    if (role === 'owner' || role === 'admin' || role === 'member') {
      return role;
    }
    return null;
  },

  async readOrganizationSubject({ organizationId }) {
    const rows = await database
      .select({
        id: dbSchema.organization.id,
        name: dbSchema.organization.name,
        slug: dbSchema.organization.slug,
      })
      .from(dbSchema.organization)
      .where(eq(dbSchema.organization.id, organizationId))
      .limit(1);

    return rows[0] ?? null;
  },

  resolveE2eStripeTestClockId(headers) {
    return resolveE2eStripeTestClockId({
      env,
      headers,
    });
  },
});
