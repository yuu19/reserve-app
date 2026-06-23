import { describe, expect, it, vi } from 'vitest';
import {
  readBillingApiShadowDiagnostic,
  resolveBillingApiShadowClient,
  type BillingApiShadowClient,
  type BillingApiShadowLegacySnapshot,
} from './billing-api-shadow.js';

const legacyPremium = {
  planCode: 'premium',
  subscriptionStatus: 'active',
  entitlementState: 'premium_enabled',
  premiumEligible: true,
  capabilities: ['organization_premium_features'],
} satisfies BillingApiShadowLegacySnapshot;

const subject = {
  organizationId: 'organization-1',
  organizationName: '予約テスト組織',
  organizationSlug: 'reserve-test',
  billingEmail: 'owner@example.com',
};

const checkedAt = new Date('2026-06-23T00:00:00.000Z');

const createClient = (overrides: Partial<BillingApiShadowClient> = {}): BillingApiShadowClient => ({
  syncSubject: vi.fn(async () => undefined),
  readEntitlements: vi.fn(async () => ({
    appId: 'reserve',
    subjectType: 'organization',
    subjectId: 'organization-1',
    planCode: 'premium',
    status: 'active',
    priceResolution: 'known',
    features: {
      staffLimit: 10,
      onlinePayment: true,
    },
    entitlements: [],
    syncedAt: '2026-06-23T00:00:00.000Z',
    maxStaleSeconds: 3600,
  })),
  ...overrides,
});

describe('Billing API shadow read', () => {
  it('明示フラグが無効なら Billing API client を作らない', () => {
    expect(resolveBillingApiShadowClient({ env: {} })).toEqual({
      enabled: false,
      disabledReason: 'disabled_by_flag',
    });
  });

  it('legacy と Billing API の premium 判定が揃う場合は matched を返す', async () => {
    const client = createClient();

    const result = await readBillingApiShadowDiagnostic({
      clientResolution: { enabled: true, client },
      subject,
      legacy: legacyPremium,
      checkedAt,
    });

    expect(result).toMatchObject({
      status: 'matched',
      checkedAt: '2026-06-23T00:00:00.000Z',
      priceResolution: 'known',
      planCode: 'premium',
      subscriptionStatus: 'active',
      features: {
        staffLimit: 10,
        onlinePayment: true,
      },
      differences: [],
    });
    expect(client.syncSubject).toHaveBeenCalledWith(
      { subjectType: 'organization', subjectId: 'organization-1' },
      expect.objectContaining({
        displayName: '予約テスト組織',
        billingEmail: 'owner@example.com',
        metadata: {
          source: 'reserve-app-backend-shadow',
          organizationSlug: 'reserve-test',
        },
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^reserve-shadow-sync:organization-1:/),
      }),
    );
  });

  it('Billing API の features が空なら legacy premium との差分を返す', async () => {
    const client = createClient({
      readEntitlements: vi.fn(async () => ({
        appId: 'reserve',
        subjectType: 'organization',
        subjectId: 'organization-1',
        planCode: 'premium',
        status: 'active',
        priceResolution: 'unknown',
        features: {},
        entitlements: [],
        syncedAt: '2026-06-23T00:00:00.000Z',
        maxStaleSeconds: 3600,
      })),
    });

    const result = await readBillingApiShadowDiagnostic({
      clientResolution: { enabled: true, client },
      subject,
      legacy: legacyPremium,
      checkedAt,
    });

    expect(result.status).toBe('mismatch');
    expect(result.differences.map((difference) => difference.field)).toEqual([
      'premiumEligible',
      'priceResolution',
    ]);
  });

  it('Billing API 呼び出し失敗時は unavailable を返す', async () => {
    const client = createClient({
      syncSubject: vi.fn(async () => {
        throw new Error('Billing API unavailable');
      }),
    });

    const result = await readBillingApiShadowDiagnostic({
      clientResolution: { enabled: true, client },
      subject,
      legacy: legacyPremium,
      checkedAt,
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      unavailableReason: 'Billing API unavailable',
      features: null,
      differences: [],
    });
  });
});
