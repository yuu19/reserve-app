import type { BillingEntitlement, BillingEntitlementInput } from './ports.js';

export const hasActiveBillingEntitlement = ({
  entitlements,
  key,
  now = new Date(),
}: {
  entitlements: BillingEntitlement[];
  key: string;
  now?: Date;
}): boolean =>
  entitlements.some(
    (entitlement) =>
      entitlement.key === key &&
      entitlement.active &&
      (!entitlement.validFrom || entitlement.validFrom.getTime() <= now.getTime()) &&
      (!entitlement.validUntil || entitlement.validUntil.getTime() > now.getTime()),
  );

export const createActiveEntitlementInput = ({
  key,
  source,
  reason,
  validFrom = null,
  validUntil = null,
}: Pick<BillingEntitlementInput, 'key' | 'source' | 'reason'> & {
  validFrom?: Date | null;
  validUntil?: Date | null;
}): BillingEntitlementInput => ({
  key,
  active: true,
  source,
  reason,
  validFrom,
  validUntil,
});
