import { describe, expect, it, vi } from 'vitest';

import {
  createOrResolveBillingCatalog,
  formatBillingCatalogSummary,
  readStripeCatalogConfig,
  runCreateStripeBillingCatalog,
} from '../scripts/create-stripe-billing-catalog.mjs';

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });

describe('create-stripe-billing-catalog script', () => {
  it('creates a product and both recurring prices when catalog is missing', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'prod_premium', name: 'WakureServe Premium' }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 'price_monthly', lookup_key: 'wakureserve_premium_monthly' }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 'price_yearly', lookup_key: 'wakureserve_premium_yearly' }),
      );

    const result = await createOrResolveBillingCatalog({
      env: {
        STRIPE_SECRET_KEY: 'sk_test_catalog',
      },
      fetchImpl: fetchMock,
    });

    expect(result.product).toMatchObject({
      id: 'prod_premium',
      created: true,
    });
    expect(result.monthly).toMatchObject({
      id: 'price_monthly',
      created: true,
    });
    expect(result.yearly).toMatchObject({
      id: 'price_yearly',
      created: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('reuses matching prices by lookup key without creating new ones', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'prod_existing',
              name: 'WakureServe Premium',
              metadata: {
                catalog_key: 'organization_premium',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'price_monthly_existing',
              lookup_key: 'wakureserve_premium_monthly',
              product: 'prod_existing',
              unit_amount: 1500,
              currency: 'jpy',
              recurring: {
                interval: 'month',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'price_yearly_existing',
              lookup_key: 'wakureserve_premium_yearly',
              product: 'prod_existing',
              unit_amount: 15800,
              currency: 'jpy',
              recurring: {
                interval: 'year',
              },
            },
          ],
        }),
      );

    const result = await createOrResolveBillingCatalog({
      env: {
        STRIPE_SECRET_KEY: 'sk_test_catalog',
      },
      fetchImpl: fetchMock,
    });

    expect(result.product.created).toBe(false);
    expect(result.monthly).toMatchObject({
      id: 'price_monthly_existing',
      created: false,
    });
    expect(result.yearly).toMatchObject({
      id: 'price_yearly_existing',
      created: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('creates a replacement price when lookup key points to mismatched config', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'prod_existing',
              name: 'WakureServe Premium',
              metadata: {
                catalog_key: 'organization_premium',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'price_monthly_old',
              lookup_key: 'wakureserve_premium_monthly',
              product: 'prod_existing',
              unit_amount: 999,
              currency: 'jpy',
              recurring: {
                interval: 'month',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'price_monthly_old', lookup_key: null }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 'price_monthly_new', lookup_key: 'wakureserve_premium_monthly' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'price_yearly_existing',
              lookup_key: 'wakureserve_premium_yearly',
              product: 'prod_existing',
              unit_amount: 15800,
              currency: 'jpy',
              recurring: {
                interval: 'year',
              },
            },
          ],
        }),
      );

    const result = await createOrResolveBillingCatalog({
      env: {
        STRIPE_SECRET_KEY: 'sk_test_catalog',
      },
      fetchImpl: fetchMock,
    });

    expect(result.monthly).toMatchObject({
      id: 'price_monthly_new',
      created: true,
      replacedPriceIds: ['price_monthly_old'],
    });
    expect(result.yearly.created).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('fails immediately when STRIPE_SECRET_KEY is missing', () => {
    expect(() => readStripeCatalogConfig({})).toThrow('STRIPE_SECRET_KEY is required.');
  });

  it('returns a non-zero style result and prints Stripe API errors', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            message: 'Invalid API key provided.',
          },
        },
        401,
      ),
    );

    const result = await runCreateStripeBillingCatalog({
      env: {
        STRIPE_SECRET_KEY: 'sk_invalid',
      },
      fetchImpl: fetchMock,
      stdout,
      stderr,
    });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid API key provided.',
    });
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith('Invalid API key provided.');
  });

  it('formats env output for the resolved catalog ids', () => {
    const summary = formatBillingCatalogSummary({
      product: {
        id: 'prod_premium',
        created: false,
      },
      monthly: {
        id: 'price_monthly',
        created: false,
        replacedPriceIds: [],
      },
      yearly: {
        id: 'price_yearly',
        created: true,
        replacedPriceIds: ['price_yearly_old'],
      },
    });

    expect(summary).toContain('STRIPE_BILLING_PRODUCT_ID=prod_premium');
    expect(summary).toContain('STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_monthly');
    expect(summary).toContain('STRIPE_PREMIUM_YEARLY_PRICE_ID=price_yearly');
    expect(summary).toContain('Yearly lookup key moved from: price_yearly_old');
  });
});
