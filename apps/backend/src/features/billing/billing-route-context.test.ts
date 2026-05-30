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

describe('課金ルートコンテキスト', () => {
  it('セッション識別子を正規化しアクティブ組織 ID へフォールバックする', async () => {
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

  it('現在のデータベースから正規化済み組織メンバーシップロールを返す', async () => {
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

  it('メンバーシップ行が未対応ロールの場合は null を返す', async () => {
    const ctx = createContext({ database: createDatabase('billing_manager').database });

    await expect(
      ctx.readOrganizationMembershipRole({
        organizationId: 'organization-1',
        userId: 'user-1',
      }),
    ).resolves.toBeNull();
  });
});
