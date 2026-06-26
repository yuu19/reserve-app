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
});
