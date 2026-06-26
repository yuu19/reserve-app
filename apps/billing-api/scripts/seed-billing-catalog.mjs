import { productBillingCatalogs } from '../../../packages/product-billing-config/src/index.mjs';

const timestampSql = "cast(unixepoch('subsecond') * 1000 as integer)";

const toSqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;

const toSqlNullableString = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? toSqlString(normalized) : 'NULL';
};

const toSqlJson = (value) => toSqlString(JSON.stringify(value));

const idPart = (value) =>
  String(value)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const buildId = (...parts) => parts.map(idPart).filter(Boolean).join('_').toLowerCase();

const statement = (sql) => `${sql};`;

const upsertBillingAppSql = (catalog) =>
  statement(`INSERT INTO billing_app (id, name, status)
VALUES (${toSqlString(catalog.app.id)}, ${toSqlString(catalog.app.name)}, 'active')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  status = excluded.status,
  updated_at = ${timestampSql}`);

const upsertProductSql = ({ catalog, product }) => {
  const productId = buildId('product', catalog.app.id, product.code);
  const providerProductId = product.providerProductEnvVar
    ? process.env[product.providerProductEnvVar]
    : null;
  return statement(`INSERT INTO billing_product (
  id,
  app_id,
  code,
  name,
  provider_product_id,
  active
)
VALUES (
  ${toSqlString(productId)},
  ${toSqlString(catalog.app.id)},
  ${toSqlString(product.code)},
  ${toSqlString(product.name)},
  ${toSqlNullableString(providerProductId)},
  true
)
ON CONFLICT(app_id, code) DO UPDATE SET
  name = excluded.name,
  provider_product_id = excluded.provider_product_id,
  active = excluded.active,
  updated_at = ${timestampSql}`);
};

const upsertPlanSql = ({ catalog, plan }) => {
  const planId = buildId('plan', catalog.app.id, plan.code);
  const productId = buildId('product', catalog.app.id, plan.productCode);
  return statement(`INSERT INTO billing_plan (
  id,
  app_id,
  product_id,
  code,
  name,
  active
)
VALUES (
  ${toSqlString(planId)},
  ${toSqlString(catalog.app.id)},
  ${toSqlString(productId)},
  ${toSqlString(plan.code)},
  ${toSqlString(plan.name)},
  true
)
ON CONFLICT(app_id, code) DO UPDATE SET
  product_id = excluded.product_id,
  name = excluded.name,
  active = excluded.active,
  updated_at = ${timestampSql}`);
};

const upsertPriceSql = ({ catalog, price }) => {
  const priceId = buildId('price', catalog.app.id, price.code);
  const planId = buildId('plan', catalog.app.id, price.planCode);
  const providerPriceId = process.env[price.providerPriceEnvVar];
  return statement(`INSERT INTO billing_price (
  id,
  app_id,
  plan_id,
  code,
  interval,
  provider,
  provider_price_id,
  currency,
  unit_amount,
  active
)
VALUES (
  ${toSqlString(priceId)},
  ${toSqlString(catalog.app.id)},
  ${toSqlString(planId)},
  ${toSqlString(price.code)},
  ${toSqlString(price.interval)},
  'stripe',
  ${toSqlNullableString(providerPriceId)},
  ${toSqlString(price.currency)},
  ${Number(price.unitAmount)},
  true
)
ON CONFLICT(app_id, code) DO UPDATE SET
  plan_id = excluded.plan_id,
  interval = excluded.interval,
  provider = excluded.provider,
  provider_price_id = excluded.provider_price_id,
  currency = excluded.currency,
  unit_amount = excluded.unit_amount,
  active = excluded.active,
  updated_at = ${timestampSql}`);
};

const upsertAddonSql = ({ catalog, addon }) => {
  const addonId = buildId('addon', catalog.app.id, addon.code);
  const productId = buildId('product', catalog.app.id, addon.productCode);
  return statement(`INSERT INTO billing_addon (
  id,
  app_id,
  product_id,
  code,
  name,
  active
)
VALUES (
  ${toSqlString(addonId)},
  ${toSqlString(catalog.app.id)},
  ${toSqlString(productId)},
  ${toSqlString(addon.code)},
  ${toSqlString(addon.name)},
  true
)
ON CONFLICT(app_id, code) DO UPDATE SET
  product_id = excluded.product_id,
  name = excluded.name,
  active = excluded.active,
  updated_at = ${timestampSql}`);
};

const upsertAddonPriceSql = ({ catalog, price }) => {
  const priceId = buildId('addon_price', catalog.app.id, price.code);
  const addonId = buildId('addon', catalog.app.id, price.addonCode);
  const providerPriceId = process.env[price.providerPriceEnvVar];
  return statement(`INSERT INTO billing_addon_price (
  id,
  app_id,
  addon_id,
  code,
  interval,
  provider,
  provider_price_id,
  currency,
  unit_amount,
  active
)
VALUES (
  ${toSqlString(priceId)},
  ${toSqlString(catalog.app.id)},
  ${toSqlString(addonId)},
  ${toSqlString(price.code)},
  ${toSqlString(price.interval)},
  'stripe',
  ${toSqlNullableString(providerPriceId)},
  ${toSqlString(price.currency)},
  ${Number(price.unitAmount)},
  true
)
ON CONFLICT(app_id, code) DO UPDATE SET
  addon_id = excluded.addon_id,
  interval = excluded.interval,
  provider = excluded.provider,
  provider_price_id = excluded.provider_price_id,
  currency = excluded.currency,
  unit_amount = excluded.unit_amount,
  active = excluded.active,
  updated_at = ${timestampSql}`);
};

const upsertEntitlementRuleSql = ({ catalog, rule }) => {
  const ruleId = buildId('entitlement_rule', catalog.app.id, rule.planCode, rule.entitlementKey);
  return statement(`INSERT INTO billing_entitlement_rule (
  id,
  app_id,
  plan_code,
  entitlement_key,
  value_type,
  value_json,
  active
)
VALUES (
  ${toSqlString(ruleId)},
  ${toSqlString(catalog.app.id)},
  ${toSqlString(rule.planCode)},
  ${toSqlString(rule.entitlementKey)},
  ${toSqlString(rule.valueType)},
  ${toSqlJson(rule.value)},
  true
)
ON CONFLICT(app_id, plan_code, entitlement_key) DO UPDATE SET
  value_type = excluded.value_type,
  value_json = excluded.value_json,
  active = excluded.active,
  updated_at = ${timestampSql}`);
};

const upsertAddonEntitlementRuleSql = ({ catalog, rule }) => {
  const ruleId = buildId(
    'addon_entitlement_rule',
    catalog.app.id,
    rule.addonCode,
    rule.entitlementKey,
  );
  return statement(`INSERT INTO billing_addon_entitlement_rule (
  id,
  app_id,
  addon_code,
  entitlement_key,
  value_type,
  value_json,
  aggregation,
  active
)
VALUES (
  ${toSqlString(ruleId)},
  ${toSqlString(catalog.app.id)},
  ${toSqlString(rule.addonCode)},
  ${toSqlString(rule.entitlementKey)},
  ${toSqlString(rule.valueType)},
  ${toSqlJson(rule.value)},
  ${toSqlString(rule.aggregation)},
  true
)
ON CONFLICT(app_id, addon_code, entitlement_key) DO UPDATE SET
  value_type = excluded.value_type,
  value_json = excluded.value_json,
  aggregation = excluded.aggregation,
  active = excluded.active,
  updated_at = ${timestampSql}`);
};

const upsertRedirectTemplateSql = ({ catalog, template }) => {
  const templateId = buildId('redirect', catalog.app.id, template.key);
  const successUrl = process.env[template.successUrlEnvVar] || template.defaultSuccessUrl;
  const cancelUrl = process.env[template.cancelUrlEnvVar] || template.defaultCancelUrl;
  return statement(`INSERT INTO billing_redirect_template (
  id,
  app_id,
  key,
  success_url,
  cancel_url
)
VALUES (
  ${toSqlString(templateId)},
  ${toSqlString(catalog.app.id)},
  ${toSqlString(template.key)},
  ${toSqlString(successUrl)},
  ${toSqlString(cancelUrl)}
)
ON CONFLICT(app_id, key) DO UPDATE SET
  success_url = excluded.success_url,
  cancel_url = excluded.cancel_url,
  updated_at = ${timestampSql}`);
};

export const generateBillingCatalogSeedSql = ({ appId = null } = {}) => {
  const catalogs = appId
    ? productBillingCatalogs.filter((catalog) => catalog.app.id === appId)
    : productBillingCatalogs;
  if (catalogs.length === 0) {
    throw new Error(`No product billing catalog found for appId: ${appId}`);
  }

  const statements = [
    '-- Generated by apps/billing-api/scripts/seed-billing-catalog.mjs',
    '-- API credentials are intentionally not generated here.',
    'BEGIN TRANSACTION;',
  ];
  for (const catalog of catalogs) {
    statements.push(`-- app: ${catalog.app.id}`);
    statements.push(upsertBillingAppSql(catalog));
    statements.push(...catalog.products.map((product) => upsertProductSql({ catalog, product })));
    statements.push(...catalog.plans.map((plan) => upsertPlanSql({ catalog, plan })));
    statements.push(...catalog.prices.map((price) => upsertPriceSql({ catalog, price })));
    statements.push(...(catalog.addons ?? []).map((addon) => upsertAddonSql({ catalog, addon })));
    statements.push(
      ...(catalog.addonPrices ?? []).map((price) => upsertAddonPriceSql({ catalog, price })),
    );
    statements.push(
      ...catalog.entitlementRules.map((rule) => upsertEntitlementRuleSql({ catalog, rule })),
    );
    statements.push(
      ...(catalog.addonEntitlementRules ?? []).map((rule) =>
        upsertAddonEntitlementRuleSql({ catalog, rule }),
      ),
    );
    statements.push(
      ...catalog.redirectTemplates.map((template) =>
        upsertRedirectTemplateSql({ catalog, template }),
      ),
    );
  }
  statements.push('COMMIT;');
  return `${statements.join('\n\n')}\n`;
};

const readAppIdArg = (args) => {
  const appIndex = args.findIndex((arg) => arg === '--app');
  return appIndex >= 0 ? args[appIndex + 1] || null : null;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(
    generateBillingCatalogSeedSql({ appId: readAppIdArg(process.argv.slice(2)) }),
  );
}
