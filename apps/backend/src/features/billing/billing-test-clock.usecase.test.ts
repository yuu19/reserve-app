import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BillingApiTestClockScenario } from '@repo/billing-types';
import type { AuthRuntimeEnv } from '../../auth-runtime.js';
import type { BillingRouteContext } from './billing.route-context.js';
import {
  advanceInternalBillingTestClockScenario,
  createInternalBillingTestClockScenario,
  readInternalBillingTestClockScenario,
} from './billing-test-clock.usecase.js';

const env = {
  INTERNAL_OPERATOR_EMAILS: 'operator@example.com',
  BILLING_API_TEST_CLOCKS_ENABLED: 'true',
  BILLING_API_TEST_CLOCKS_ENV: 'sandbox',
  BILLING_API_BASE_URL: 'https://billing.test',
  BILLING_API_KEY: 'billing-api-key',
} satisfies AuthRuntimeEnv;

const scenario = {
  scenarioId: 'scenario-1',
  appId: 'reserve',
  scenarioType: 'payment_failed',
  status: 'ready',
  provider: 'stripe',
  providerTestClockId: 'clock_1',
  providerCustomerId: 'cus_1',
  providerSubscriptionId: 'sub_1',
  frozenTime: '2026-06-28T00:00:00.000Z',
  targetFrozenTime: null,
  lastAdvancedAt: null,
  sourceSubject: {
    subjectType: 'organization',
    subjectId: 'organization-1',
  },
  testSubject: {
    subjectType: 'organization',
    subjectId: 'organization-1',
  },
  summary: {},
  createdAt: '2026-06-28T00:00:00.000Z',
  updatedAt: '2026-06-28T00:00:00.000Z',
} as BillingApiTestClockScenario;

type CapturedRequest = {
  url: string;
  init: RequestInit;
};

const createFetchMock = ({
  failStatus,
}: {
  failStatus?: number;
} = {}) => {
  const requests: CapturedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      init: init ?? {},
    });

    if (failStatus) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'forbidden_scope',
            message: 'Billing API scope rejected.',
          },
        }),
        { status: failStatus },
      );
    }

    const method = init?.method;
    return new Response(JSON.stringify(method === 'PUT' ? { synced: true } : scenario), {
      status: 200,
    });
  });

  return {
    requests,
    fetchMock,
  };
};

const header = (request: CapturedRequest, name: string): string | null => {
  const headers = request.init.headers;
  return headers instanceof Headers ? headers.get(name) : null;
};

const jsonBody = (request: CapturedRequest) => JSON.parse(String(request.init.body)) as unknown;

const createContext = (envOverride: Partial<AuthRuntimeEnv> = {}) =>
  ({
    env: {
      ...env,
      ...envOverride,
    },
    getSessionIdentity: vi.fn(async () => ({
      userId: 'user-1',
      email: 'operator@example.com',
      emailVerified: true,
      activeOrganizationId: 'organization-1',
    })),
    readOrganizationSubject: vi.fn(async () => ({
      id: 'organization-1',
      name: '予約テスト組織',
      slug: 'reserve-test',
    })),
  }) as unknown as BillingRouteContext;

describe('Billing API Test Clock internal proxy usecase', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('二重 opt-in が揃わない場合は Billing API を呼ばない', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const ctx = createContext({
      BILLING_API_TEST_CLOCKS_ENABLED: 'true',
      BILLING_API_TEST_CLOCKS_ENV: 'production',
    });

    const result = await createInternalBillingTestClockScenario({
      ctx,
      params: { organizationId: 'organization-1' },
      body: { scenarioType: 'payment_failed' },
      headers: new Headers(),
    });

    expect(result).toEqual({
      status: 422,
      body: { message: 'Billing API Test Clock proxy is disabled.' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('scenario 作成時だけ source organization を Billing API に同期する', async () => {
    const { requests, fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const ctx = createContext();

    const result = await createInternalBillingTestClockScenario({
      ctx,
      params: { organizationId: 'organization-1' },
      body: {
        scenarioType: 'payment_failed',
        frozenTime: '2026-06-28T00:00:00.000Z',
        interval: 'month',
      },
      headers: new Headers(),
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(scenario);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: 'https://billing.test/api/v1/apps/reserve/subjects/organization/organization-1',
      init: { method: 'PUT' },
    });
    expect(jsonBody(requests[0])).toMatchObject({
      displayName: '予約テスト組織',
      billingEmail: 'operator@example.com',
      metadata: {
        source: 'reserve-app-backend-test-clock',
        organizationSlug: 'reserve-test',
      },
    });
    expect(header(requests[0], 'idempotency-key')).toMatch(
      /^reserve-test-clock-sync:organization-1:[a-f0-9]{24}$/,
    );

    expect(requests[1]).toMatchObject({
      url: 'https://billing.test/api/v1/test/apps/reserve/subjects/organization/organization-1/clock-scenarios',
      init: { method: 'POST' },
    });
    expect(jsonBody(requests[1])).toMatchObject({
      scenarioType: 'payment_failed',
      frozenTime: '2026-06-28T00:00:00.000Z',
      interval: 'month',
      actor: {
        type: 'user',
        id: 'user-1',
        email: 'operator@example.com',
      },
    });
    expect(header(requests[1], 'idempotency-key')).toMatch(
      /^reserve-test-clock-create:organization-1:payment_failed:[a-f0-9]{24}$/,
    );
  });

  it('scenario 取得時は Billing API subject sync を実行しない', async () => {
    const { requests, fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const ctx = createContext();

    const result = await readInternalBillingTestClockScenario({
      ctx,
      params: {
        organizationId: 'organization-1',
        scenarioId: 'scenario-1',
      },
      headers: new Headers(),
    });

    expect(result.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'https://billing.test/api/v1/test/apps/reserve/subjects/organization/organization-1/clock-scenarios/scenario-1',
      init: { method: 'GET' },
    });
  });

  it('scenario advance 時は Billing API subject sync を実行せず idempotency key を付与する', async () => {
    const { requests, fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const ctx = createContext();

    const result = await advanceInternalBillingTestClockScenario({
      ctx,
      params: {
        organizationId: 'organization-1',
        scenarioId: 'scenario-1',
      },
      body: {
        advanceBy: {
          amount: 7,
          unit: 'day',
        },
      },
      headers: new Headers(),
    });

    expect(result.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'https://billing.test/api/v1/test/apps/reserve/subjects/organization/organization-1/clock-scenarios/scenario-1/advance',
      init: { method: 'POST' },
    });
    expect(header(requests[0], 'idempotency-key')).toMatch(
      /^reserve-test-clock-advance:organization-1:scenario-1:[a-f0-9]{24}$/,
    );
  });

  it('Billing API の認可エラーは安全な backend message に変換する', async () => {
    const { fetchMock } = createFetchMock({ failStatus: 403 });
    vi.stubGlobal('fetch', fetchMock);
    const ctx = createContext();

    const result = await readInternalBillingTestClockScenario({
      ctx,
      params: {
        organizationId: 'organization-1',
        scenarioId: 'scenario-1',
      },
      headers: new Headers(),
    });

    expect(result).toEqual({
      status: 503,
      body: { message: 'Billing API Test Clock scenario read is unavailable.' },
    });
  });
});
