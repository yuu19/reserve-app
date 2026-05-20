import type {
  BillingCatalog,
  BillingCatalogPrice,
  BillingInterval,
  CatalogBuildResult,
  CatalogValidationError,
} from '@repo/saas-billing-core';
import type { AuthRuntimeEnv } from '../../auth-runtime.js';

const buildPrice = ({
  planCode,
  interval,
  priceId,
}: {
  planCode: string;
  interval: BillingInterval;
  priceId?: string | null;
}): BillingCatalogPrice | CatalogValidationError => {
  const providerPriceId = priceId?.trim() ?? '';
  if (!providerPriceId) {
    return {
      code: 'billing_price_not_configured',
      planCode,
      interval,
      provider: 'stripe',
      message: `Stripe ${planCode} ${interval} price id is not configured.`,
    };
  }

  return {
    planCode,
    interval,
    provider: 'stripe',
    providerPriceId,
  };
};

export const buildOrganizationBillingCatalog = (env: AuthRuntimeEnv): CatalogBuildResult => {
  const candidates = [
    buildPrice({
      planCode: 'premium',
      interval: 'month',
      priceId: env.STRIPE_PREMIUM_MONTHLY_PRICE_ID,
    }),
    buildPrice({
      planCode: 'premium',
      interval: 'year',
      priceId: env.STRIPE_PREMIUM_YEARLY_PRICE_ID,
    }),
  ];

  const prices = candidates.filter(
    (candidate): candidate is BillingCatalogPrice => 'providerPriceId' in candidate,
  );
  const errors = candidates.filter(
    (candidate): candidate is CatalogValidationError => 'code' in candidate,
  );

  if (prices.length === 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    catalog: {
      prices,
    } satisfies BillingCatalog,
  };
};

export const listOrganizationBillingCatalogIntervals = (
  catalogResult: CatalogBuildResult,
): BillingInterval[] => {
  if (!catalogResult.ok) {
    return [];
  }
  return catalogResult.catalog.prices.map((price) => price.interval);
};

export const resolveOrganizationBillingPriceId = ({
  catalogResult,
  interval,
}: {
  catalogResult: CatalogBuildResult;
  interval: BillingInterval;
}) => {
  if (!catalogResult.ok) {
    return {
      ok: false as const,
      error: catalogResult.errors.find((entry) => entry.interval === interval) ??
        catalogResult.errors[0] ?? {
          code: 'billing_price_not_configured' as const,
          planCode: 'premium',
          interval,
          provider: 'stripe' as const,
          message: 'Stripe premium price id is not configured.',
        },
    };
  }

  const price = catalogResult.catalog.prices.find(
    (candidate) => candidate.planCode === 'premium' && candidate.interval === interval,
  );
  if (!price) {
    return {
      ok: false as const,
      error: {
        code: 'billing_interval_not_supported' as const,
        planCode: 'premium',
        interval,
        provider: 'stripe' as const,
        message: `Premium ${interval} price id is not configured.`,
      },
    };
  }

  return {
    ok: true as const,
    priceId: price.providerPriceId,
  };
};
