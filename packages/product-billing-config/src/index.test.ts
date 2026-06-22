import { describe, expect, test } from 'vitest';
import { findProductBillingCatalog, reserveBillingCatalog } from './index.mjs';

describe('product billing config', () => {
  test('defines reserve premium catalog and feature entitlements', () => {
    expect(findProductBillingCatalog('reserve')).toBe(reserveBillingCatalog);
    expect(reserveBillingCatalog.prices.map((price) => price.interval)).toEqual(['month', 'year']);
    expect(
      Object.fromEntries(
        reserveBillingCatalog.entitlementRules.map((rule) => [rule.entitlementKey, rule.value]),
      ),
    ).toEqual({
      staffLimit: 10,
      shopLimit: 3,
      monthlyReservationLimit: 3000,
      onlinePayment: true,
      customDomain: true,
      reminderNotification: true,
    });
  });
});
