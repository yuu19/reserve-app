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
    expect(sql).toContain('INSERT INTO billing_addon (');
    expect(sql).toContain('INSERT INTO billing_addon_price (');
    expect(sql).toContain('INSERT INTO billing_addon_entitlement_rule (');
    expect(sql).toContain("'staff_seat'");
    expect(sql).toContain("'shop_slot'");
    expect(sql).toContain("'staffLimit'");
    expect(sql).toContain('API credentials are intentionally not generated here.');
    expect(sql).not.toContain('billing_app_credential');
  });

  test('uses Stripe price ids from environment when present', () => {
    vi.stubEnv('STRIPE_PREMIUM_MONTHLY_PRICE_ID', 'price_monthly_123');
    vi.stubEnv('STRIPE_PREMIUM_YEARLY_PRICE_ID', 'price_yearly_123');
    vi.stubEnv('STRIPE_STAFF_SEAT_MONTHLY_PRICE_ID', 'price_staff_123');
    vi.stubEnv('STRIPE_SHOP_SLOT_MONTHLY_PRICE_ID', 'price_shop_123');

    const sql = generateBillingCatalogSeedSql({ appId: 'reserve' });

    expect(sql).toContain("'price_monthly_123'");
    expect(sql).toContain("'price_yearly_123'");
    expect(sql).toContain("'price_staff_123'");
    expect(sql).toContain("'price_shop_123'");
  });
});
