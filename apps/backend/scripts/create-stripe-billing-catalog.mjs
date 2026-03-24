import { pathToFileURL } from 'node:url';

const STRIPE_API_BASE_URL = 'https://api.stripe.com/v1';
const STRIPE_API_VERSION = '2026-01-28.clover';
const ORGANIZATION_PREMIUM_CATALOG_KEY = 'organization_premium';

const DEFAULT_PRODUCT_NAME = 'WakureServe Premium';
const DEFAULT_MONTHLY_LOOKUP_KEY = 'wakureserve_premium_monthly';
const DEFAULT_YEARLY_LOOKUP_KEY = 'wakureserve_premium_yearly';

const CATALOG_DEFINITIONS = Object.freeze({
  monthly: {
    envKey: 'STRIPE_PREMIUM_MONTHLY_PRICE_ID',
    billingInterval: 'month',
    lookupKeyEnvName: 'STRIPE_BILLING_MONTHLY_LOOKUP_KEY',
    defaultLookupKey: DEFAULT_MONTHLY_LOOKUP_KEY,
    unitAmount: 1500,
  },
  yearly: {
    envKey: 'STRIPE_PREMIUM_YEARLY_PRICE_ID',
    billingInterval: 'year',
    lookupKeyEnvName: 'STRIPE_BILLING_YEARLY_LOOKUP_KEY',
    defaultLookupKey: DEFAULT_YEARLY_LOOKUP_KEY,
    unitAmount: 15800,
  },
});

const isRecord = (value) => typeof value === 'object' && value !== null;

const readStripeErrorMessage = (payload) => {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return 'Stripe API request failed.';
  }

  return typeof payload.error.message === 'string' && payload.error.message.length > 0
    ? payload.error.message
    : 'Stripe API request failed.';
};

const stripeRequest = async ({
  secretKey,
  method = 'GET',
  path,
  query,
  body,
  fetchImpl = fetch,
}) => {
  const normalizedPath = path.replace(/^\/+/, '');
  const url = new URL(`${STRIPE_API_BASE_URL}/${normalizedPath}`);
  if (query) {
    for (const [key, value] of query.entries()) {
      url.searchParams.append(key, value);
    }
  }

  const response = await fetchImpl(url, {
    method,
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'stripe-version': STRIPE_API_VERSION,
    },
    body: body ? body.toString() : undefined,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readStripeErrorMessage(payload));
  }

  return payload;
};

const readLookupKey = (env, name, fallback) => {
  const candidate = env[name];
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : fallback;
};

export const readStripeCatalogConfig = (env = process.env) => {
  const secretKey = typeof env.STRIPE_SECRET_KEY === 'string' ? env.STRIPE_SECRET_KEY.trim() : '';
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is required.');
  }

  const productName =
    typeof env.STRIPE_BILLING_PRODUCT_NAME === 'string' &&
    env.STRIPE_BILLING_PRODUCT_NAME.trim().length > 0
      ? env.STRIPE_BILLING_PRODUCT_NAME.trim()
      : DEFAULT_PRODUCT_NAME;

  return {
    secretKey,
    productName,
    catalogKey: ORGANIZATION_PREMIUM_CATALOG_KEY,
    currency: 'jpy',
    plans: {
      monthly: {
        ...CATALOG_DEFINITIONS.monthly,
        lookupKey: readLookupKey(
          env,
          CATALOG_DEFINITIONS.monthly.lookupKeyEnvName,
          CATALOG_DEFINITIONS.monthly.defaultLookupKey,
        ),
      },
      yearly: {
        ...CATALOG_DEFINITIONS.yearly,
        lookupKey: readLookupKey(
          env,
          CATALOG_DEFINITIONS.yearly.lookupKeyEnvName,
          CATALOG_DEFINITIONS.yearly.defaultLookupKey,
        ),
      },
    },
  };
};

const findProductByCatalogKey = (products, catalogKey) =>
  products.find(
    (product) => isRecord(product.metadata) && product.metadata.catalog_key === catalogKey,
  ) ?? null;

const findProductByName = (products, productName) =>
  products.find((product) => typeof product.name === 'string' && product.name === productName) ??
  null;

const listActiveProducts = async ({ secretKey, fetchImpl }) => {
  const query = new URLSearchParams();
  query.set('active', 'true');
  query.set('limit', '100');
  const payload = await stripeRequest({
    secretKey,
    path: 'products',
    query,
    fetchImpl,
  });

  return Array.isArray(payload?.data) ? payload.data.filter(isRecord) : [];
};

const createProduct = async ({ secretKey, productName, catalogKey, fetchImpl }) => {
  const body = new URLSearchParams();
  body.set('name', productName);
  body.set('metadata[catalog_key]', catalogKey);

  const payload = await stripeRequest({
    secretKey,
    method: 'POST',
    path: 'products',
    body,
    fetchImpl,
  });

  if (!isRecord(payload) || typeof payload.id !== 'string') {
    throw new Error('Invalid Stripe product response.');
  }

  return payload;
};

const listPricesByLookupKey = async ({ secretKey, lookupKey, fetchImpl }) => {
  const query = new URLSearchParams();
  query.append('lookup_keys[]', lookupKey);
  query.set('limit', '100');
  const payload = await stripeRequest({
    secretKey,
    path: 'prices',
    query,
    fetchImpl,
  });

  return Array.isArray(payload?.data) ? payload.data.filter(isRecord) : [];
};

const matchesExpectedPrice = ({
  price,
  productId,
  lookupKey,
  unitAmount,
  currency,
  billingInterval,
}) => {
  if (!isRecord(price)) {
    return false;
  }

  const recurring = isRecord(price.recurring) ? price.recurring : null;
  return (
    typeof price.id === 'string' &&
    price.lookup_key === lookupKey &&
    price.product === productId &&
    price.unit_amount === unitAmount &&
    price.currency === currency &&
    recurring?.interval === billingInterval
  );
};

const transferLookupKeyIfNeeded = async ({ secretKey, price, lookupKey, fetchImpl }) => {
  if (!isRecord(price) || typeof price.id !== 'string' || price.lookup_key !== lookupKey) {
    return;
  }

  const body = new URLSearchParams();
  body.set('lookup_key', '');
  await stripeRequest({
    secretKey,
    method: 'POST',
    path: `prices/${price.id}`,
    body,
    fetchImpl,
  });
};

const createPrice = async ({
  secretKey,
  productId,
  catalogKey,
  lookupKey,
  unitAmount,
  currency,
  billingInterval,
  fetchImpl,
}) => {
  const body = new URLSearchParams();
  body.set('currency', currency);
  body.set('unit_amount', String(unitAmount));
  body.set('product', productId);
  body.set('lookup_key', lookupKey);
  body.set('recurring[interval]', billingInterval);
  body.set('metadata[catalog_key]', catalogKey);
  body.set('metadata[plan_code]', 'premium');
  body.set('metadata[billing_interval]', billingInterval);

  const payload = await stripeRequest({
    secretKey,
    method: 'POST',
    path: 'prices',
    body,
    fetchImpl,
  });

  if (!isRecord(payload) || typeof payload.id !== 'string') {
    throw new Error('Invalid Stripe price response.');
  }

  return payload;
};

const resolveOrCreateProduct = async ({ secretKey, productName, catalogKey, fetchImpl }) => {
  const products = await listActiveProducts({ secretKey, fetchImpl });
  const existing =
    findProductByCatalogKey(products, catalogKey) ?? findProductByName(products, productName);
  if (existing) {
    return {
      product: existing,
      created: false,
      matchedBy: findProductByCatalogKey(products, catalogKey) ? 'catalog_key' : 'name',
    };
  }

  return {
    product: await createProduct({ secretKey, productName, catalogKey, fetchImpl }),
    created: true,
    matchedBy: null,
  };
};

const resolveOrCreatePrice = async ({
  secretKey,
  productId,
  catalogKey,
  lookupKey,
  unitAmount,
  currency,
  billingInterval,
  fetchImpl,
}) => {
  const existingPrices = await listPricesByLookupKey({ secretKey, lookupKey, fetchImpl });
  const reusablePrice =
    existingPrices.find((price) =>
      matchesExpectedPrice({ price, productId, lookupKey, unitAmount, currency, billingInterval }),
    ) ?? null;

  if (reusablePrice) {
    return {
      price: reusablePrice,
      created: false,
      replacedPriceIds: [],
    };
  }

  const pricesHoldingLookupKey = existingPrices.filter((price) => price.lookup_key === lookupKey);
  for (const price of pricesHoldingLookupKey) {
    await transferLookupKeyIfNeeded({ secretKey, price, lookupKey, fetchImpl });
  }

  return {
    price: await createPrice({
      secretKey,
      productId,
      catalogKey,
      lookupKey,
      unitAmount,
      currency,
      billingInterval,
      fetchImpl,
    }),
    created: true,
    replacedPriceIds: pricesHoldingLookupKey
      .map((price) => (typeof price.id === 'string' ? price.id : null))
      .filter((value) => value !== null),
  };
};

export const createOrResolveBillingCatalog = async ({
  env = process.env,
  fetchImpl = fetch,
} = {}) => {
  const config = readStripeCatalogConfig(env);

  const {
    product,
    created: productCreated,
    matchedBy,
  } = await resolveOrCreateProduct({
    secretKey: config.secretKey,
    productName: config.productName,
    catalogKey: config.catalogKey,
    fetchImpl,
  });

  if (typeof product.id !== 'string') {
    throw new Error('Invalid Stripe product response.');
  }

  const monthly = await resolveOrCreatePrice({
    secretKey: config.secretKey,
    productId: product.id,
    catalogKey: config.catalogKey,
    lookupKey: config.plans.monthly.lookupKey,
    unitAmount: config.plans.monthly.unitAmount,
    currency: config.currency,
    billingInterval: config.plans.monthly.billingInterval,
    fetchImpl,
  });

  const yearly = await resolveOrCreatePrice({
    secretKey: config.secretKey,
    productId: product.id,
    catalogKey: config.catalogKey,
    lookupKey: config.plans.yearly.lookupKey,
    unitAmount: config.plans.yearly.unitAmount,
    currency: config.currency,
    billingInterval: config.plans.yearly.billingInterval,
    fetchImpl,
  });

  return {
    product: {
      id: product.id,
      name: typeof product.name === 'string' ? product.name : config.productName,
      created: productCreated,
      matchedBy,
    },
    monthly: {
      id: monthly.price.id,
      lookupKey: config.plans.monthly.lookupKey,
      unitAmount: config.plans.monthly.unitAmount,
      created: monthly.created,
      replacedPriceIds: monthly.replacedPriceIds,
    },
    yearly: {
      id: yearly.price.id,
      lookupKey: config.plans.yearly.lookupKey,
      unitAmount: config.plans.yearly.unitAmount,
      created: yearly.created,
      replacedPriceIds: yearly.replacedPriceIds,
    },
  };
};

export const formatBillingCatalogSummary = (result) => {
  const lines = [
    'Stripe billing catalog is ready.',
    '',
    `Product: ${result.product.id} (${result.product.created ? 'created' : 'reused'})`,
    `Monthly price: ${result.monthly.id} (${result.monthly.created ? 'created' : 'reused'})`,
    `Yearly price: ${result.yearly.id} (${result.yearly.created ? 'created' : 'reused'})`,
  ];

  if (result.monthly.replacedPriceIds.length > 0) {
    lines.push(`Monthly lookup key moved from: ${result.monthly.replacedPriceIds.join(', ')}`);
  }
  if (result.yearly.replacedPriceIds.length > 0) {
    lines.push(`Yearly lookup key moved from: ${result.yearly.replacedPriceIds.join(', ')}`);
  }

  lines.push('', 'Set these backend env vars:', `STRIPE_BILLING_PRODUCT_ID=${result.product.id}`);
  lines.push(`STRIPE_PREMIUM_MONTHLY_PRICE_ID=${result.monthly.id}`);
  lines.push(`STRIPE_PREMIUM_YEARLY_PRICE_ID=${result.yearly.id}`);

  return lines.join('\n');
};

export const runCreateStripeBillingCatalog = async ({
  env = process.env,
  fetchImpl = fetch,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  try {
    const result = await createOrResolveBillingCatalog({ env, fetchImpl });
    stdout(formatBillingCatalogSummary(result));
    return {
      ok: true,
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    stderr(message);
    return {
      ok: false,
      error: message,
    };
  }
};

const shouldRunAsCli = () => {
  const entryArg = process.argv[1];
  if (!entryArg) {
    return false;
  }
  return import.meta.url === pathToFileURL(entryArg).href;
};

if (shouldRunAsCli()) {
  const execution = await runCreateStripeBillingCatalog();
  if (!execution.ok) {
    process.exitCode = 1;
  }
}
