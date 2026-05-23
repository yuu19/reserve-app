export {
  buildOrganizationBillingCatalog as createReserveAppBillingCatalog,
  listOrganizationBillingCatalogIntervals as listReserveAppBillingCatalogIntervals,
  resolveOrganizationBillingPriceId as resolveReserveAppBillingPriceId,
} from '../billing.catalog.js';

import type { AuthRuntimeEnv } from '../../../auth-runtime.js';

export const resolveReserveAppBillingIntervalFromPriceId = (
  env: AuthRuntimeEnv,
  priceId: string | null,
): 'month' | 'year' | null => {
  if (!priceId) {
    return null;
  }
  if (env.STRIPE_PREMIUM_MONTHLY_PRICE_ID?.trim() === priceId) {
    return 'month';
  }
  if (env.STRIPE_PREMIUM_YEARLY_PRICE_ID?.trim() === priceId) {
    return 'year';
  }
  return null;
};
