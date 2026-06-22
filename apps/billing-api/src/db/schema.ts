import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const defaultTimestampMs = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull();

const defaultUpdatedTimestampMs = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull();

export const billingApp = sqliteTable('billing_app', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').default('active').notNull(),
  createdAt: defaultTimestampMs(),
  updatedAt: defaultUpdatedTimestampMs(),
});

export const billingAppCredential = sqliteTable(
  'billing_app_credential',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopesJson: text('scopes_json').notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_app_credential_hash_uidx').on(table.keyHash),
    index('billing_app_credential_app_idx').on(table.appId),
  ],
);

export const billingParty = sqliteTable('billing_party', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  primaryEmail: text('primary_email'),
  createdAt: defaultTimestampMs(),
  updatedAt: defaultUpdatedTimestampMs(),
});

export const billingSubject = sqliteTable(
  'billing_subject',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    partyId: text('party_id')
      .notNull()
      .references(() => billingParty.id, { onDelete: 'restrict' }),
    status: text('status').default('active').notNull(),
    displayName: text('display_name').notNull(),
    billingEmail: text('billing_email'),
    billingName: text('billing_name'),
    billingContactsJson: text('billing_contacts_json').default('[]').notNull(),
    metadataJson: text('metadata_json').default('{}').notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_subject_app_subject_uidx').on(
      table.appId,
      table.subjectType,
      table.subjectId,
    ),
    index('billing_subject_party_idx').on(table.partyId),
  ],
);

export const billingAccount = sqliteTable(
  'billing_account',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    subjectRowId: text('subject_row_id')
      .notNull()
      .references(() => billingSubject.id, { onDelete: 'cascade' }),
    partyId: text('party_id')
      .notNull()
      .references(() => billingParty.id, { onDelete: 'restrict' }),
    provider: text('provider').default('stripe').notNull(),
    providerCustomerId: text('provider_customer_id'),
    billingEmail: text('billing_email'),
    billingName: text('billing_name'),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_account_subject_uidx').on(table.appId, table.subjectRowId),
    uniqueIndex('billing_account_provider_customer_uidx').on(
      table.provider,
      table.providerCustomerId,
    ),
  ],
);

export const billingSubscription = sqliteTable(
  'billing_subscription',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    provider: text('provider').default('stripe').notNull(),
    providerSubscriptionId: text('provider_subscription_id'),
    providerScheduleId: text('provider_schedule_id'),
    planCode: text('plan_code').default('free').notNull(),
    priceCode: text('price_code'),
    interval: text('interval'),
    status: text('status').default('free').notNull(),
    currentPeriodStart: integer('current_period_start', { mode: 'timestamp_ms' }),
    currentPeriodEnd: integer('current_period_end', { mode: 'timestamp_ms' }),
    trialStart: integer('trial_start', { mode: 'timestamp_ms' }),
    trialEnd: integer('trial_end', { mode: 'timestamp_ms' }),
    cancelAt: integer('cancel_at', { mode: 'timestamp_ms' }),
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' })
      .default(false)
      .notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    index('billing_subscription_account_idx').on(table.billingAccountId),
    uniqueIndex('billing_subscription_provider_subscription_uidx').on(
      table.provider,
      table.providerSubscriptionId,
    ),
  ],
);

export const billingEntitlement = sqliteTable(
  'billing_entitlement',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    subjectRowId: text('subject_row_id')
      .notNull()
      .references(() => billingSubject.id, { onDelete: 'cascade' }),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull(),
    valueType: text('value_type').default('boolean').notNull(),
    valueJson: text('value_json').default('true').notNull(),
    source: text('source').notNull(),
    reason: text('reason').notNull(),
    validFrom: integer('valid_from', { mode: 'timestamp_ms' }),
    validUntil: integer('valid_until', { mode: 'timestamp_ms' }),
    generatedAt: integer('generated_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_entitlement_subject_key_uidx').on(
      table.appId,
      table.subjectRowId,
      table.key,
    ),
    index('billing_entitlement_key_active_idx').on(table.appId, table.key, table.active),
  ],
);

export const billingProduct = sqliteTable(
  'billing_product',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    providerProductId: text('provider_product_id'),
    active: integer('active', { mode: 'boolean' }).default(true).notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [uniqueIndex('billing_product_app_code_uidx').on(table.appId, table.code)],
);

export const billingPlan = sqliteTable(
  'billing_plan',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => billingProduct.id, { onDelete: 'set null' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    active: integer('active', { mode: 'boolean' }).default(true).notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [uniqueIndex('billing_plan_app_code_uidx').on(table.appId, table.code)],
);

export const billingPrice = sqliteTable(
  'billing_price',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => billingPlan.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    interval: text('interval'),
    provider: text('provider').default('stripe').notNull(),
    providerPriceId: text('provider_price_id'),
    currency: text('currency').default('jpy').notNull(),
    unitAmount: integer('unit_amount'),
    active: integer('active', { mode: 'boolean' }).default(true).notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_price_app_code_uidx').on(table.appId, table.code),
    uniqueIndex('billing_price_provider_uidx').on(table.provider, table.providerPriceId),
  ],
);

export const billingEntitlementRule = sqliteTable(
  'billing_entitlement_rule',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    planCode: text('plan_code').notNull(),
    entitlementKey: text('entitlement_key').notNull(),
    valueType: text('value_type').default('boolean').notNull(),
    valueJson: text('value_json').default('true').notNull(),
    active: integer('active', { mode: 'boolean' }).default(true).notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_entitlement_rule_plan_key_uidx').on(
      table.appId,
      table.planCode,
      table.entitlementKey,
    ),
  ],
);

export const billingRedirectTemplate = sqliteTable(
  'billing_redirect_template',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    successUrl: text('success_url').notNull(),
    cancelUrl: text('cancel_url'),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [uniqueIndex('billing_redirect_template_key_uidx').on(table.appId, table.key)],
);

export const billingApiIdempotency = sqliteTable(
  'billing_api_idempotency',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code'),
    responseJson: text('response_json'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_api_idempotency_key_uidx').on(table.appId, table.idempotencyKey),
    index('billing_api_idempotency_expiry_idx').on(table.expiresAt),
  ],
);

export const billingProviderEvent = sqliteTable(
  'billing_provider_event',
  {
    id: text('id').primaryKey(),
    appId: text('app_id').references(() => billingApp.id, { onDelete: 'set null' }),
    provider: text('provider').default('stripe').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    scope: text('scope').default('billing').notNull(),
    payloadHash: text('payload_hash').notNull(),
    processingStatus: text('processing_status').notNull(),
    receiptStatus: text('receipt_status').notNull(),
    billingAccountId: text('billing_account_id').references(() => billingAccount.id, {
      onDelete: 'set null',
    }),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    failureReason: text('failure_reason'),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('billing_provider_event_uidx').on(
      table.provider,
      table.providerEventId,
      table.scope,
    ),
    index('billing_provider_event_status_idx').on(table.processingStatus, table.createdAt),
  ],
);
