import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateBillingApiCredentialSql } from '../../../apps/billing-api/scripts/create-billing-api-credential.mjs';
import { generateBillingCatalogSeedSql } from '../../../apps/billing-api/scripts/seed-billing-catalog.mjs';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const persistRoot = path.join(repoRoot, '.wrangler/e2e');
const wranglerConfigHome = path.join(persistRoot, 'config');
const envFile = path.join(os.tmpdir(), 'reserve-app-billing-api-e2e.vars');
const seedFile = path.join(os.tmpdir(), 'reserve-app-billing-api-e2e-seed.sql');
const appId = 'reserve';
const rawApiKey =
  process.env.BILLING_API_E2E_KEY?.trim() ||
  'rbk_test_e2e_billing_api_test_clock_secret_000000000000000000000000';

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Billing API E2E tests.`);
  }
  return value;
};

const quoteEnvValue = (value) => JSON.stringify(value);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      CI: '1',
      XDG_CONFIG_HOME: wranglerConfigHome,
      ...options.env,
    },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}.`);
  }
};

const stripeSecretKey = requiredEnv('STRIPE_SECRET_KEY');
if (!stripeSecretKey.startsWith('sk_test_')) {
  throw new Error('STRIPE_SECRET_KEY must be a Stripe testmode key for Billing API E2E tests.');
}

const webhookSecret =
  process.env.STRIPE_WEBHOOK_SECRET?.trim() ||
  process.env.E2E_STRIPE_WEBHOOK_SECRET?.trim() ||
  'whsec_reserve_app_local_e2e';
const premiumMonthlyPriceId = requiredEnv('STRIPE_PREMIUM_MONTHLY_PRICE_ID');
const premiumYearlyPriceId = requiredEnv('STRIPE_PREMIUM_YEARLY_PRICE_ID');
const staffSeatMonthlyPriceId = requiredEnv('STRIPE_STAFF_SEAT_MONTHLY_PRICE_ID');
const shopSlotMonthlyPriceId = requiredEnv('STRIPE_SHOP_SLOT_MONTHLY_PRICE_ID');

Object.assign(process.env, {
  STRIPE_PREMIUM_MONTHLY_PRICE_ID: premiumMonthlyPriceId,
  STRIPE_PREMIUM_YEARLY_PRICE_ID: premiumYearlyPriceId,
  STRIPE_STAFF_SEAT_MONTHLY_PRICE_ID: staffSeatMonthlyPriceId,
  STRIPE_SHOP_SLOT_MONTHLY_PRICE_ID: shopSlotMonthlyPriceId,
});

fs.mkdirSync(wranglerConfigHome, { recursive: true });

run('pnpm', [
  '--filter',
  '@apps/billing-api',
  'exec',
  'wrangler',
  'd1',
  'migrations',
  'apply',
  'reserve-billing-api',
  '--local',
  '--persist-to',
  '../../.wrangler/e2e',
]);

const catalogSeedSql = generateBillingCatalogSeedSql({ appId });
const credentialSeedSql = generateBillingApiCredentialSql({
  appId,
  keyPrefix: 'rbk_test',
  rawKey: rawApiKey,
  credentialId: 'cred_reserve_e2e_test_clock',
  scopes: ['subject:write', 'billing:read', 'billing:write', 'billing:test_clock'],
});
fs.writeFileSync(seedFile, `${catalogSeedSql}\n${credentialSeedSql}\n`, { mode: 0o600 });

run(
  'pnpm',
  [
    '--filter',
    '@apps/billing-api',
    'exec',
    'wrangler',
    'd1',
    'execute',
    'reserve-billing-api',
    '--local',
    '--persist-to',
    '../../.wrangler/e2e',
    '--file',
    seedFile,
  ],
  {
    env: {
      STRIPE_PREMIUM_MONTHLY_PRICE_ID: premiumMonthlyPriceId,
      STRIPE_PREMIUM_YEARLY_PRICE_ID: premiumYearlyPriceId,
      STRIPE_STAFF_SEAT_MONTHLY_PRICE_ID: staffSeatMonthlyPriceId,
      STRIPE_SHOP_SLOT_MONTHLY_PRICE_ID: shopSlotMonthlyPriceId,
    },
  },
);

const values = {
  BILLING_ENTITLEMENT_MAX_STALE_SECONDS: '3600',
  BILLING_API_IDEMPOTENCY_TTL_SECONDS: '86400',
  BILLING_HANDOFF_REUSE_SECONDS: '1800',
  BILLING_DEFAULT_RETURN_URL_KEY: 'default',
  BILLING_RETURN_URL_OVERRIDE_ALLOWED: 'false',
  BILLING_DEFAULT_CURRENCY: 'jpy',
  BILLING_TEST_CLOCKS_ENABLED: 'true',
  BILLING_API_ENV: 'sandbox',
  STRIPE_SECRET_KEY: stripeSecretKey,
  STRIPE_WEBHOOK_SECRET: webhookSecret,
};

fs.writeFileSync(
  envFile,
  Object.entries(values)
    .map(([key, value]) => `${key}=${quoteEnvValue(value)}`)
    .join('\n') + '\n',
  { mode: 0o600 },
);

process.stdout.write(
  [
    `BILLING_API_E2E_BASE_URL=http://localhost:3010`,
    `BILLING_API_E2E_KEY=${rawApiKey}`,
    `BILLING_API_E2E_ENV_FILE=${envFile}`,
    '',
  ].join('\n'),
);
