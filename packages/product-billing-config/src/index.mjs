const reservePremiumFeatures = [
  { key: 'staffLimit', valueType: 'number', value: 10 },
  { key: 'shopLimit', valueType: 'number', value: 3 },
  { key: 'monthlyReservationLimit', valueType: 'number', value: 3000 },
  { key: 'onlinePayment', valueType: 'boolean', value: true },
  { key: 'customDomain', valueType: 'boolean', value: true },
  { key: 'reminderNotification', valueType: 'boolean', value: true },
];

export const reserveBillingCatalog = {
  app: {
    id: 'reserve',
    name: 'Reserve App',
  },
  products: [
    {
      code: 'reserve_premium',
      name: 'Reserve Premium',
      providerProductEnvVar: 'STRIPE_BILLING_PRODUCT_ID',
    },
  ],
  plans: [
    {
      code: 'premium',
      name: 'Premium',
      productCode: 'reserve_premium',
    },
  ],
  prices: [
    {
      code: 'premium_monthly',
      planCode: 'premium',
      interval: 'month',
      currency: 'jpy',
      unitAmount: 1500,
      providerPriceEnvVar: 'STRIPE_PREMIUM_MONTHLY_PRICE_ID',
      lookupKey: 'wakureserve_premium_monthly',
    },
    {
      code: 'premium_yearly',
      planCode: 'premium',
      interval: 'year',
      currency: 'jpy',
      unitAmount: 15800,
      providerPriceEnvVar: 'STRIPE_PREMIUM_YEARLY_PRICE_ID',
      lookupKey: 'wakureserve_premium_yearly',
    },
  ],
  entitlementRules: reservePremiumFeatures.map((feature) => ({
    planCode: 'premium',
    entitlementKey: feature.key,
    valueType: feature.valueType,
    value: feature.value,
  })),
  redirectTemplates: [
    {
      key: 'default',
      successUrlEnvVar: 'BILLING_RESERVE_RETURN_URL',
      cancelUrlEnvVar: 'BILLING_RESERVE_CANCEL_URL',
      defaultSuccessUrl: 'https://web.wakureserve.com/contracts',
      defaultCancelUrl: 'https://web.wakureserve.com/contracts',
    },
  ],
};

export const productBillingCatalogs = [reserveBillingCatalog];

/** @param {string} appId */
export const findProductBillingCatalog = (appId) =>
  productBillingCatalogs.find((catalog) => catalog.app.id === appId) ?? null;
