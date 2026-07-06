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
    providerPriceId: text('provider_price_id'),
    priceResolution: text('price_resolution').default('not_applicable').notNull(),
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

export const billingSubscriptionAddonItem = sqliteTable(
  'billing_subscription_addon_item',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    billingSubscriptionId: text('billing_subscription_id')
      .notNull()
      .references(() => billingSubscription.id, { onDelete: 'cascade' }),
    addonCode: text('addon_code').notNull(),
    addonPriceCode: text('addon_price_code'),
    provider: text('provider').default('stripe').notNull(),
    providerSubscriptionItemId: text('provider_subscription_item_id'),
    providerPriceId: text('provider_price_id'),
    quantity: integer('quantity').default(0).notNull(),
    status: text('status').default('active').notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_subscription_addon_item_subscription_addon_uidx').on(
      table.billingSubscriptionId,
      table.addonCode,
    ),
    uniqueIndex('billing_subscription_addon_item_provider_item_uidx').on(
      table.provider,
      table.providerSubscriptionItemId,
    ),
    index('billing_subscription_addon_item_app_subscription_idx').on(
      table.appId,
      table.billingSubscriptionId,
    ),
  ],
);

export const billingInvoiceEvent = sqliteTable(
  'billing_invoice_event',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    billingSubscriptionId: text('billing_subscription_id').references(
      () => billingSubscription.id,
      {
        onDelete: 'set null',
      },
    ),
    provider: text('provider').default('stripe').notNull(),
    providerEventId: text('provider_event_id'),
    eventType: text('event_type').notNull(),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    providerInvoiceId: text('provider_invoice_id'),
    providerPaymentIntentId: text('provider_payment_intent_id'),
    providerStatus: text('provider_status'),
    ownerFacingStatus: text('owner_facing_status').notNull(),
    hostedInvoiceUrl: text('hosted_invoice_url'),
    invoicePdfUrl: text('invoice_pdf_url'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    index('billing_invoice_event_account_created_idx').on(table.billingAccountId, table.createdAt),
    uniqueIndex('billing_invoice_event_provider_uidx').on(
      table.provider,
      table.providerEventId,
      table.eventType,
    ),
    index('billing_invoice_event_invoice_idx').on(table.provider, table.providerInvoiceId),
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

export const billingAddon = sqliteTable(
  'billing_addon',
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
  (table) => [uniqueIndex('billing_addon_app_code_uidx').on(table.appId, table.code)],
);

export const billingAddonPrice = sqliteTable(
  'billing_addon_price',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    addonId: text('addon_id')
      .notNull()
      .references(() => billingAddon.id, { onDelete: 'cascade' }),
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
    uniqueIndex('billing_addon_price_app_code_uidx').on(table.appId, table.code),
    uniqueIndex('billing_addon_price_provider_uidx').on(table.provider, table.providerPriceId),
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

export const billingAddonEntitlementRule = sqliteTable(
  'billing_addon_entitlement_rule',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    addonCode: text('addon_code').notNull(),
    entitlementKey: text('entitlement_key').notNull(),
    valueType: text('value_type').default('number').notNull(),
    valueJson: text('value_json').default('1').notNull(),
    aggregation: text('aggregation').default('increment').notNull(),
    active: integer('active', { mode: 'boolean' }).default(true).notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_addon_entitlement_rule_addon_key_uidx').on(
      table.appId,
      table.addonCode,
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

export const billingOperationAttempt = sqliteTable(
  'billing_operation_attempt',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    reuseKey: text('reuse_key').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    state: text('state').notNull(),
    handoffUrl: text('handoff_url'),
    handoffExpiresAt: integer('handoff_expires_at', { mode: 'timestamp_ms' }),
    provider: text('provider').default('stripe').notNull(),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    providerCheckoutSessionId: text('provider_checkout_session_id'),
    providerPortalSessionId: text('provider_portal_session_id'),
    failureReason: text('failure_reason'),
    actorType: text('actor_type'),
    actorId: text('actor_id'),
    actorEmail: text('actor_email'),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_operation_attempt_idempotency_uidx').on(table.appId, table.idempotencyKey),
    uniqueIndex('billing_operation_attempt_reuse_attempt_uidx').on(
      table.appId,
      table.billingAccountId,
      table.reuseKey,
      table.attemptNumber,
    ),
    index('billing_operation_attempt_reuse_state_idx').on(
      table.appId,
      table.billingAccountId,
      table.reuseKey,
      table.state,
    ),
    index('billing_operation_attempt_handoff_expiry_idx').on(table.handoffExpiresAt),
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

export const billingTestClockScenario = sqliteTable(
  'billing_test_clock_scenario',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => billingApp.id, { onDelete: 'cascade' }),
    sourceSubjectRowId: text('source_subject_row_id')
      .notNull()
      .references(() => billingSubject.id, { onDelete: 'cascade' }),
    testSubjectRowId: text('test_subject_row_id')
      .notNull()
      .references(() => billingSubject.id, { onDelete: 'cascade' }),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    provider: text('provider').default('stripe').notNull(),
    providerTestClockId: text('provider_test_clock_id').notNull(),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    scenarioType: text('scenario_type').notNull(),
    frozenTime: integer('frozen_time', { mode: 'timestamp_ms' }).notNull(),
    targetFrozenTime: integer('target_frozen_time', { mode: 'timestamp_ms' }),
    status: text('status').notNull(),
    lastAdvancedAt: integer('last_advanced_at', { mode: 'timestamp_ms' }),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_test_clock_scenario_clock_uidx').on(
      table.provider,
      table.providerTestClockId,
    ),
    uniqueIndex('billing_test_clock_scenario_test_subject_uidx').on(
      table.appId,
      table.testSubjectRowId,
    ),
    index('billing_test_clock_scenario_source_idx').on(table.appId, table.sourceSubjectRowId),
    index('billing_test_clock_scenario_status_idx').on(table.status, table.updatedAt),
  ],
);
