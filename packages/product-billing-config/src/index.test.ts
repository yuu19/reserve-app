import { describe, expect, test } from 'vitest';
import { findProductBillingCatalog, reserveBillingCatalog } from './index.mjs';

describe('product billing config', () => {
  test('defines reserve premium catalog and feature entitlements', () => {
    expect(findProductBillingCatalog('reserve')).toBe(reserveBillingCatalog);
    expect(reserveBillingCatalog.prices.map((price) => price.interval)).toEqual(['month', 'year']);
    expect(reserveBillingCatalog.addons.map((addon) => addon.code)).toEqual([
      'staff_seat',
      'shop_slot',
    ]);
    expect(
      Object.fromEntries(
        reserveBillingCatalog.addonEntitlementRules.map((rule) => [
          rule.addonCode,
          [rule.entitlementKey, rule.value, rule.aggregation],
        ]),
      ),
    ).toEqual({
      staff_seat: ['staffLimit', 1, 'increment'],
      shop_slot: ['shopLimit', 1, 'increment'],
    });
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
