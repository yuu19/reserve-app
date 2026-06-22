import { afterEach, describe, expect, test, vi } from 'vitest';
import { generateBillingCatalogSeedSql } from './seed-billing-catalog.mjs';

describe('generateBillingCatalogSeedSql', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('generates reserve catalog seed SQL without API credentials', () => {
    const sql = generateBillingCatalogSeedSql({ appId: 'reserve' });

    expect(sql).toContain('INSERT INTO billing_app (id, name, status)');
    expect(sql).toContain("'reserve'");
    expect(sql).toContain("'premium_monthly'");
    expect(sql).toContain("'staffLimit'");
    expect(sql).toContain('API credentials are intentionally not generated here.');
    expect(sql).not.toContain('billing_app_credential');
  });

  test('uses Stripe price ids from environment when present', () => {
    vi.stubEnv('STRIPE_PREMIUM_MONTHLY_PRICE_ID', 'price_monthly_123');
    vi.stubEnv('STRIPE_PREMIUM_YEARLY_PRICE_ID', 'price_yearly_123');

    const sql = generateBillingCatalogSeedSql({ appId: 'reserve' });

    expect(sql).toContain("'price_monthly_123'");
    expect(sql).toContain("'price_yearly_123'");
  });
});
