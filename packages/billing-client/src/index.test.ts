import { describe, expect, test } from 'vitest';
import { BillingClientError, createBillingClient } from './index.js';

const createJsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('createBillingClient', () => {
  test('subject sync uses app-scoped path, bearer auth, and idempotency key', async () => {
    const requests: Request[] = [];
    const client = createBillingClient({
      baseUrl: 'https://billing.example.com/',
      appId: 'reserve',
      apiKey: 'billing_test_key',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return createJsonResponse({
          subject: {
            appId: 'reserve',
            subjectType: 'organization',
            subjectId: 'org_1',
            status: 'active',
            displayName: 'Reserve Org',
            billingEmail: null,
            billingName: null,
            billingContacts: [],
            metadata: {},
            createdAt: '2026-06-22T00:00:00.000Z',
            updatedAt: '2026-06-22T00:00:00.000Z',
          },
          account: {
            id: 'acct_1',
            provider: 'stripe',
            providerCustomerId: null,
            createdAt: '2026-06-22T00:00:00.000Z',
            updatedAt: '2026-06-22T00:00:00.000Z',
          },
          subscription: null,
          entitlements: {
            appId: 'reserve',
            subjectType: 'organization',
            subjectId: 'org_1',
            planCode: 'free',
            status: 'free',
            priceResolution: 'not_applicable',
            features: {},
            entitlements: [],
            syncedAt: '2026-06-22T00:00:00.000Z',
            evaluatedAt: '2026-06-22T00:00:00.000Z',
            timeSource: 'server',
            maxStaleSeconds: 3600,
          },
        });
      },
    });

    await client.syncSubject(
      { subjectType: 'organization', subjectId: 'org_1' },
      { displayName: 'Reserve Org' },
      { idempotencyKey: 'sync-org-1' },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url).toBe(
      'https://billing.example.com/api/v1/apps/reserve/subjects/organization/org_1',
    );
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer billing_test_key');
    expect(requests[0]?.headers.get('idempotency-key')).toBe('sync-org-1');
  });

  test('throws BillingClientError with API error body', async () => {
    const client = createBillingClient({
      baseUrl: 'https://billing.example.com',
      appId: 'reserve',
      apiKey: 'billing_test_key',
      fetch: async () =>
        createJsonResponse(
          {
            error: {
              code: 'subject_not_found',
              message: 'Billing subject is not synced.',
            },
          },
          404,
        ),
    });

    await expect(
      client.readEntitlements({ subjectType: 'organization', subjectId: 'missing' }),
    ).rejects.toMatchObject({
      name: 'BillingClientError',
      status: 404,
      message: 'Billing subject is not synced.',
    } satisfies Partial<BillingClientError>);
  });

  test('reads invoice events with subject scoped path and limit', async () => {
    const requests: Request[] = [];
    const client = createBillingClient({
      baseUrl: 'https://billing.example.com',
      appId: 'reserve',
      apiKey: 'billing_test_key',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return createJsonResponse({
          appId: 'reserve',
          subjectType: 'organization',
          subjectId: 'org_1',
          events: [],
          limit: 25,
          hasMore: false,
          syncedAt: '2026-06-26T00:00:00.000Z',
        });
      },
    });

    await client.readInvoiceEvents(
      { subjectType: 'organization', subjectId: 'org_1' },
      { limit: 25 },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe(
      'https://billing.example.com/api/v1/apps/reserve/subjects/organization/org_1/invoice-events?limit=25',
    );
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer billing_test_key');
  });

  test('reads and updates addon items with subject scoped paths and an idempotency key', async () => {
    const requests: Request[] = [];
    const client = createBillingClient({
      baseUrl: 'https://billing.example.com',
      appId: 'reserve',
      apiKey: 'billing_test_key',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return createJsonResponse({
          subject: {},
          account: {},
          subscription: null,
          entitlements: {},
          provider: {},
        });
      },
    });

    await client.readAddonItems({ subjectType: 'organization', subjectId: 'org_1' });
    await client.updateAddonItems(
      { subjectType: 'organization', subjectId: 'org_1' },
      {
        items: [
          { addonCode: 'staff_seat', quantity: 2 },
          { addonCode: 'shop_slot', quantity: 0 },
        ],
        actor: { type: 'user', id: 'user_1', email: 'owner@example.com' },
      },
      { idempotencyKey: 'addon-staff-seat-2' },
    );

    expect(requests).toHaveLength(2);
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe(
      'https://billing.example.com/api/v1/apps/reserve/subjects/organization/org_1/addon-items',
    );
    expect(requests[1]?.method).toBe('PATCH');
    expect(requests[1]?.url).toBe(
      'https://billing.example.com/api/v1/apps/reserve/subjects/organization/org_1/addon-items',
    );
    expect(requests[1]?.headers.get('authorization')).toBe('Bearer billing_test_key');
    expect(requests[1]?.headers.get('idempotency-key')).toBe('addon-staff-seat-2');
    await expect(requests[1]?.json()).resolves.toEqual({
      items: [
        { addonCode: 'staff_seat', quantity: 2 },
        { addonCode: 'shop_slot', quantity: 0 },
      ],
      actor: { type: 'user', id: 'user_1', email: 'owner@example.com' },
    });
  });

  test('creates and advances Test Clock scenarios on test scoped paths', async () => {
    const requests: Request[] = [];
    const client = createBillingClient({
      baseUrl: 'https://billing.example.com',
      appId: 'reserve',
      apiKey: 'billing_test_key',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return createJsonResponse({
          scenarioId: 'scenario_1',
          appId: 'reserve',
          scenarioType: 'trial_expired_without_payment_method',
          status: 'ready',
          provider: 'stripe',
          providerTestClockId: 'clock_123',
          providerCustomerId: 'cus_123',
          providerSubscriptionId: 'sub_123',
          frozenTime: '2026-06-27T00:00:00.000Z',
          targetFrozenTime: null,
          lastAdvancedAt: null,
          sourceSubject: { subjectType: 'organization', subjectId: 'org_1' },
          testSubject: {
            subjectType: 'organization',
            subjectId: 'org_1__tc_trial_expired_without_payment_method_scenario',
          },
          summary: {},
          createdAt: '2026-06-27T00:00:00.000Z',
          updatedAt: '2026-06-27T00:00:00.000Z',
        });
      },
    });

    await client.createTestClockScenario(
      { subjectType: 'organization', subjectId: 'org_1' },
      {
        scenarioType: 'monthly_renewal_success',
        frozenTime: '2026-06-27T00:00:00.000Z',
      },
      { idempotencyKey: 'create-scenario' },
    );
    await client.advanceTestClockScenario(
      { subjectType: 'organization', subjectId: 'org_1' },
      'scenario_1',
      { advanceBy: { amount: 1, unit: 'month' } },
      { idempotencyKey: 'advance-scenario' },
    );
    await client.readTestClockScenario(
      { subjectType: 'organization', subjectId: 'org_1' },
      'scenario_1',
    );

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      'POST https://billing.example.com/api/v1/test/apps/reserve/subjects/organization/org_1/clock-scenarios',
      'POST https://billing.example.com/api/v1/test/apps/reserve/subjects/organization/org_1/clock-scenarios/scenario_1/advance',
      'GET https://billing.example.com/api/v1/test/apps/reserve/subjects/organization/org_1/clock-scenarios/scenario_1',
    ]);
    expect(requests[0]?.headers.get('idempotency-key')).toBe('create-scenario');
    expect(requests[1]?.headers.get('idempotency-key')).toBe('advance-scenario');
    await expect(requests[0]?.json()).resolves.toMatchObject({
      scenarioType: 'monthly_renewal_success',
      frozenTime: '2026-06-27T00:00:00.000Z',
    });
    await expect(requests[1]?.json()).resolves.toEqual({
      advanceBy: { amount: 1, unit: 'month' },
    });
  });
});
