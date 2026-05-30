import { describe, expect, it, vi } from 'vitest';
import type { AuthInstance, AuthRuntimeDatabase } from '../../auth-runtime.js';
import { createAiRouteContext } from './ai-route-context.js';

const createContext = (session: unknown, env: { INTERNAL_OPERATOR_EMAILS?: string } = {}) => {
  const getSession = vi.fn(async () => session);
  return {
    ctx: createAiRouteContext({
      auth: {
        api: {
          getSession,
        },
      } as unknown as AuthInstance,
      database: {} as AuthRuntimeDatabase,
      env,
    }),
    getSession,
  };
};

describe('AI ルートコンテキスト', () => {
  it('未認証リクエストでは内部オペレーターアクセスを拒否する', async () => {
    const { ctx, getSession } = createContext(null, {
      INTERNAL_OPERATOR_EMAILS: 'operator@example.com',
    });

    await expect(ctx.ensureInternalOperator({ headers: new Headers() })).resolves.toEqual({
      status: 401,
    });
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('メールが許可外または未確認の場合は内部オペレーターアクセスを拒否する', async () => {
    const unlisted = createContext(
      {
        user: {
          id: 'user-a',
          email: 'member@example.com',
          emailVerified: true,
        },
        session: {
          activeOrganizationId: 'org-a',
        },
      },
      {
        INTERNAL_OPERATOR_EMAILS: 'operator@example.com',
      },
    );

    await expect(unlisted.ctx.ensureInternalOperator({ headers: new Headers() })).resolves.toEqual({
      status: 403,
    });

    const unverified = createContext(
      {
        user: {
          id: 'user-a',
          email: 'operator@example.com',
          emailVerified: false,
        },
        session: {
          activeOrganizationId: 'org-a',
        },
      },
      {
        INTERNAL_OPERATOR_EMAILS: 'operator@example.com',
      },
    );

    await expect(
      unverified.ctx.ensureInternalOperator({ headers: new Headers() }),
    ).resolves.toEqual({
      status: 403,
    });
  });

  it('確認済み許可リストメールには内部オペレーターアクセスを許可する', async () => {
    const { ctx } = createContext(
      {
        user: {
          id: 'user-a',
          email: ' Operator@Example.COM ',
          emailVerified: true,
        },
        session: {
          activeOrganizationId: 'org-a',
        },
      },
      {
        INTERNAL_OPERATOR_EMAILS: 'operator@example.com',
      },
    );

    await expect(ctx.ensureInternalOperator({ headers: new Headers() })).resolves.toEqual({
      status: 200,
    });
  });
});
