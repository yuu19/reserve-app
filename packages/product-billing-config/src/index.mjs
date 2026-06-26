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
  addons: [
    {
      code: 'staff_seat',
      name: 'Staff seat add-on',
      productCode: 'reserve_premium',
    },
    {
      code: 'shop_slot',
      name: 'Shop slot add-on',
      productCode: 'reserve_premium',
    },
  ],
  addonPrices: [
    {
      code: 'staff_seat_monthly',
      addonCode: 'staff_seat',
      interval: 'month',
      currency: 'jpy',
      unitAmount: 500,
      providerPriceEnvVar: 'STRIPE_STAFF_SEAT_MONTHLY_PRICE_ID',
      lookupKey: 'wakureserve_staff_seat_monthly',
    },
    {
      code: 'shop_slot_monthly',
      addonCode: 'shop_slot',
      interval: 'month',
      currency: 'jpy',
      unitAmount: 1000,
      providerPriceEnvVar: 'STRIPE_SHOP_SLOT_MONTHLY_PRICE_ID',
      lookupKey: 'wakureserve_shop_slot_monthly',
    },
  ],
  addonEntitlementRules: [
    {
      addonCode: 'staff_seat',
      entitlementKey: 'staffLimit',
      valueType: 'number',
      value: 1,
      aggregation: 'increment',
    },
    {
      addonCode: 'shop_slot',
      entitlementKey: 'shopLimit',
      valueType: 'number',
      value: 1,
      aggregation: 'increment',
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
