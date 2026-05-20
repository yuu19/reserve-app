import type { BillingInterval, BillingProviderCode } from './types.js';

export type CatalogValidationErrorCode =
  | 'billing_price_not_configured'
  | 'billing_plan_not_found'
  | 'billing_interval_not_supported'
  | 'billing_unknown_provider_price';

export type CatalogValidationError = {
  code: CatalogValidationErrorCode;
  planCode?: string;
  interval?: BillingInterval;
  provider?: BillingProviderCode;
  providerPriceId?: string;
  message: string;
};

export type BillingCatalogPrice = {
  planCode: string;
  interval: BillingInterval;
  provider: BillingProviderCode;
  providerPriceId: string;
};

export type BillingCatalog = {
  prices: BillingCatalogPrice[];
};

export type CatalogBuildResult =
  | { ok: true; catalog: BillingCatalog }
  | { ok: false; errors: CatalogValidationError[] };

export const findCatalogPrice = ({
  catalog,
  planCode,
  interval,
}: {
  catalog: BillingCatalog;
  planCode: string;
  interval: BillingInterval;
}): BillingCatalogPrice | null =>
  catalog.prices.find((price) => price.planCode === planCode && price.interval === interval) ??
  null;

export const findCatalogPriceByProviderPriceId = ({
  catalog,
  provider,
  providerPriceId,
}: {
  catalog: BillingCatalog;
  provider: BillingProviderCode;
  providerPriceId: string;
}): BillingCatalogPrice | null =>
  catalog.prices.find(
    (price) => price.provider === provider && price.providerPriceId === providerPriceId,
  ) ?? null;
