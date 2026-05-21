import { describe, expect, it, vi } from 'vitest';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { createBillingRouteContext } from './billing.route-context.js';

const createDatabase = (role: string | null = 'owner') => {
  const limit = vi.fn(async () => (role ? [{ role }] : []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    database: { select } as unknown as AuthRuntimeDatabase,
    select,
    from,
    where,
    limit,
  };
};

const createContext = ({
  session,
  database = createDatabase().database,
}: {
  session?: unknown;
  database?: AuthRuntimeDatabase;
} = {}) =>
  createBillingRouteContext({
    auth: {
      api: {
        getSession: vi.fn(async () => session),
      },
    } as never,
    database,
    env: {},
    store: null as never,
    operationStore: null as never,
    createProvider: vi.fn() as never,
  });

describe('billing route context', () => {
  it('normalizes session identity and falls back to the active organization id', async () => {
    const ctx = createContext({
      session: {
        user: {
          id: 'user-1',
          email: ' Owner@Example.COM ',
          emailVerified: true,
        },
        session: {
          activeOrganizationId: 'organization-active',
        },
      },
    });

    await expect(ctx.getSessionIdentity(new Headers())).resolves.toEqual({
      userId: 'user-1',
      email: 'owner@example.com',
      emailVerified: true,
      activeOrganizationId: 'organization-active',
    });
    expect(
      ctx.resolveOrganizationId({
        activeOrganizationId: 'organization-active',
      }),
    ).toBe('organization-active');
    expect(
      ctx.resolveOrganizationId({
        requestedOrganizationId: 'organization-requested',
        activeOrganizationId: 'organization-active',
      }),
    ).toBe('organization-requested');
  });

  it('returns normalized organization membership roles from the current database', async () => {
    const query = createDatabase('admin');
    const ctx = createContext({ database: query.database });

    await expect(
      ctx.readOrganizationMembershipRole({
        organizationId: 'organization-1',
        userId: 'user-1',
      }),
    ).resolves.toBe('admin');
    expect(query.select).toHaveBeenCalledTimes(1);
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it('returns null when the membership row has an unsupported role', async () => {
    const ctx = createContext({ database: createDatabase('billing_manager').database });

    await expect(
      ctx.readOrganizationMembershipRole({
        organizationId: 'organization-1',
        userId: 'user-1',
      }),
    ).resolves.toBeNull();
  });
});
