export type ProductBillingValueType = 'boolean' | 'number' | 'string' | 'json' | 'none';

export type ProductBillingCatalog = {
  app: {
    id: string;
    name: string;
  };
  products: Array<{
    code: string;
    name: string;
    providerProductEnvVar?: string;
  }>;
  plans: Array<{
    code: string;
    name: string;
    productCode: string;
  }>;
  prices: Array<{
    code: string;
    planCode: string;
    interval: 'month' | 'year';
    currency: string;
    unitAmount: number;
    providerPriceEnvVar: string;
    lookupKey: string;
  }>;
  entitlementRules: Array<{
    planCode: string;
    entitlementKey: string;
    valueType: ProductBillingValueType;
    value: unknown;
  }>;
  redirectTemplates: Array<{
    key: string;
    successUrlEnvVar: string;
    cancelUrlEnvVar: string;
    defaultSuccessUrl: string;
    defaultCancelUrl: string;
  }>;
};

export const reserveBillingCatalog: ProductBillingCatalog;
export const productBillingCatalogs: ProductBillingCatalog[];
export const findProductBillingCatalog: (appId: string) => ProductBillingCatalog | null;
