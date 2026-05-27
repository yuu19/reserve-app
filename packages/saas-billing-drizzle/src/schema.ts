import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const defaultTimestampMs = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull();

const defaultUpdatedTimestampMs = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull();

/** 課金対象 subject と決済プロバイダー側 customer を結びつける root table。 */
export const billingAccount = sqliteTable(
  'billing_account',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    provider: text('provider').notNull(),
    providerCustomerId: text('provider_customer_id'),
    billingEmail: text('billing_email'),
    billingName: text('billing_name'),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_account_subject_uidx').on(table.subjectType, table.subjectId),
    uniqueIndex('billing_account_provider_customer_uidx').on(
      table.provider,
      table.providerCustomerId,
    ),
  ],
);

/** billing account ごとの現在または最新の subscription 状態を保持する table。 */
export const billingSubscription = sqliteTable(
  'billing_subscription',
  {
    id: text('id').primaryKey(),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerSubscriptionId: text('provider_subscription_id'),
    providerScheduleId: text('provider_schedule_id'),
    planCode: text('plan_code').notNull(),
    priceCode: text('price_code'),
    interval: text('interval'),
    status: text('status').notNull(),
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

/** 支払い失敗や要対応状態の現在値を billing account 単位で保持する table。 */
export const billingPaymentIssue = sqliteTable(
  'billing_payment_issue',
  {
    id: text('id').primaryKey(),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    billingSubscriptionId: text('billing_subscription_id').references(
      () => billingSubscription.id,
      {
        onDelete: 'set null',
      },
    ),
    state: text('state').notNull(),
    issueStartedAt: integer('issue_started_at', { mode: 'timestamp_ms' }),
    issueStartedAtSource: text('issue_started_at_source').notNull(),
    pastDueGraceEndsAt: integer('past_due_grace_ends_at', { mode: 'timestamp_ms' }),
    latestProviderEventId: text('latest_provider_event_id'),
    latestInvoiceId: text('latest_invoice_id'),
    latestPaymentIntentId: text('latest_payment_intent_id'),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_payment_issue_account_uidx').on(table.billingAccountId),
    index('billing_payment_issue_state_idx').on(table.state),
  ],
);

/** invoice/payment event の追記専用履歴を保持する table。 */
export const billingInvoiceEvent = sqliteTable(
  'billing_invoice_event',
  {
    id: text('id').primaryKey(),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    billingSubscriptionId: text('billing_subscription_id').references(
      () => billingSubscription.id,
      {
        onDelete: 'set null',
      },
    ),
    eventType: text('event_type').notNull(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id'),
    providerInvoiceId: text('provider_invoice_id'),
    providerPaymentIntentId: text('provider_payment_intent_id'),
    providerStatus: text('provider_status'),
    ownerFacingStatus: text('owner_facing_status'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }),
    createdAt: defaultTimestampMs(),
  },
  (table) => [
    index('billing_invoice_event_account_created_idx').on(table.billingAccountId, table.createdAt),
    uniqueIndex('billing_invoice_event_provider_uidx').on(
      table.provider,
      table.providerEventId,
      table.eventType,
    ),
  ],
);

/** entitlement の現在値を billing account と key 単位で保持する table。 */
export const billingEntitlement = sqliteTable(
  'billing_entitlement',
  {
    id: text('id').primaryKey(),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull(),
    source: text('source').notNull(),
    reason: text('reason').notNull(),
    validFrom: integer('valid_from', { mode: 'timestamp_ms' }),
    validUntil: integer('valid_until', { mode: 'timestamp_ms' }),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_entitlement_account_key_uidx').on(table.billingAccountId, table.key),
    index('billing_entitlement_key_active_idx').on(table.key, table.active),
  ],
);

/** 決済プロバイダー webhook event の受領・重複・処理状態を保持する table。 */
export const billingProviderEvent = sqliteTable(
  'billing_provider_event',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    scope: text('scope').notNull(),
    payloadHash: text('payload_hash').notNull(),
    processingStatus: text('processing_status').notNull(),
    receiptStatus: text('receipt_status').notNull(),
    duplicateDetected: integer('duplicate_detected', { mode: 'boolean' }).default(false).notNull(),
    duplicateDetectedAt: integer('duplicate_detected_at', { mode: 'timestamp_ms' }),
    attemptCount: integer('attempt_count').default(1).notNull(),
    processingStartedAt: integer('processing_started_at', { mode: 'timestamp_ms' }),
    lastAttemptAt: integer('last_attempt_at', { mode: 'timestamp_ms' }),
    processingStaleAfterMs: integer('processing_stale_after_ms').notNull(),
    failureReason: text('failure_reason'),
    failureStage: text('failure_stage'),
    lastFailureReason: text('last_failure_reason'),
    lastFailureAt: integer('last_failure_at', { mode: 'timestamp_ms' }),
    billingAccountId: text('billing_account_id').references(() => billingAccount.id, {
      onDelete: 'set null',
    }),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
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
    index('billing_provider_event_processing_idx').on(
      table.processingStatus,
      table.processingStartedAt,
    ),
  ],
);

/** Checkout/Portal など決済プロバイダーへの引き渡し操作の試行履歴を保持する table。 */
export const billingOperationAttempt = sqliteTable(
  'billing_operation_attempt',
  {
    id: text('id').primaryKey(),
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
    provider: text('provider').notNull(),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    providerCheckoutSessionId: text('provider_checkout_session_id'),
    providerPortalSessionId: text('provider_portal_session_id'),
    failureReason: text('failure_reason'),
    createdByUserId: text('created_by_user_id'),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_operation_attempt_idempotency_uidx').on(table.idempotencyKey),
    uniqueIndex('billing_operation_attempt_reuse_attempt_uidx').on(
      table.billingAccountId,
      table.reuseKey,
      table.attemptNumber,
    ),
    index('billing_operation_attempt_reuse_state_idx').on(
      table.billingAccountId,
      table.reuseKey,
      table.state,
    ),
    index('billing_operation_attempt_handoff_expiry_idx').on(table.handoffExpiresAt),
  ],
);

/** 課金状態変更の監査用 snapshot 履歴を sequence 付きで保持する table。 */
export const billingAuditEvent = sqliteTable(
  'billing_audit_event',
  {
    id: text('id').primaryKey(),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    sequenceNumber: integer('sequence_number').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceContext: text('source_context'),
    actorUserId: text('actor_user_id'),
    previousSnapshotJson: text('previous_snapshot_json'),
    nextSnapshotJson: text('next_snapshot_json'),
    provider: text('provider'),
    providerEventId: text('provider_event_id'),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    createdAt: defaultTimestampMs(),
  },
  (table) => [
    index('billing_audit_event_account_created_idx').on(table.billingAccountId, table.createdAt),
    uniqueIndex('billing_audit_event_account_sequence_uidx').on(
      table.billingAccountId,
      table.sequenceNumber,
    ),
  ],
);

/** 課金状態からアプリ側へ伝搬した signal 履歴を sequence 付きで保持する table。 */
export const billingSignal = sqliteTable(
  'billing_signal',
  {
    id: text('id').primaryKey(),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    sequenceNumber: integer('sequence_number').notNull(),
    signalKind: text('signal_kind').notNull(),
    signalStatus: text('signal_status').notNull(),
    sourceKind: text('source_kind').notNull(),
    reason: text('reason').notNull(),
    appSnapshotJson: text('app_snapshot_json'),
    provider: text('provider'),
    providerEventId: text('provider_event_id'),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    providerPlanState: text('provider_plan_state'),
    providerSubscriptionStatus: text('provider_subscription_status'),
    createdAt: defaultTimestampMs(),
  },
  (table) => [
    index('billing_signal_account_kind_status_idx').on(
      table.billingAccountId,
      table.signalKind,
      table.signalStatus,
    ),
    uniqueIndex('billing_signal_account_sequence_uidx').on(
      table.billingAccountId,
      table.sequenceNumber,
    ),
  ],
);

/** 支払い失敗や trial 期限などの通知試行履歴を sequence 付きで保持する table。 */
export const billingNotification = sqliteTable(
  'billing_notification',
  {
    id: text('id').primaryKey(),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    notificationKind: text('notification_kind').notNull(),
    channel: text('channel').default('email').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    recipientUserId: text('recipient_user_id'),
    recipientEmail: text('recipient_email').notNull(),
    deliveryStatus: text('delivery_status').notNull(),
    attemptNumber: integer('attempt_number').default(1).notNull(),
    providerMessageId: text('provider_message_id'),
    failureReason: text('failure_reason'),
    provider: text('provider'),
    providerEventId: text('provider_event_id'),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    providerInvoiceId: text('provider_invoice_id'),
    planState: text('plan_state'),
    subscriptionStatus: text('subscription_status'),
    paymentMethodStatus: text('payment_method_status'),
    trialEndsAt: integer('trial_ends_at', { mode: 'timestamp_ms' }),
    createdAt: defaultTimestampMs(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    failedAt: integer('failed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('billing_notification_dedupe_uidx').on(
      table.billingAccountId,
      table.notificationKind,
      table.recipientEmail,
      table.providerEventId,
      table.attemptNumber,
      table.deliveryStatus,
    ),
    uniqueIndex('billing_notification_account_sequence_uidx').on(
      table.billingAccountId,
      table.sequenceNumber,
    ),
    index('billing_notification_retry_idx').on(table.notificationKind, table.deliveryStatus),
  ],
);

/** invoice PDF や領収書 URL など決済プロバイダー側 document 参照を保持する table。 */
export const billingDocumentReference = sqliteTable(
  'billing_document_reference',
  {
    id: text('id').primaryKey(),
    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),
    documentKind: text('document_kind').notNull(),
    provider: text('provider').notNull(),
    providerDocumentId: text('provider_document_id').notNull(),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    hostedInvoiceUrl: text('hosted_invoice_url'),
    invoicePdfUrl: text('invoice_pdf_url'),
    receiptUrl: text('receipt_url'),
    availability: text('availability').notNull(),
    ownerFacingStatus: text('owner_facing_status').notNull(),
    providerDerived: integer('provider_derived', { mode: 'boolean' }).default(true).notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('billing_document_reference_provider_uidx').on(
      table.provider,
      table.providerDocumentId,
      table.documentKind,
    ),
    index('billing_document_reference_account_idx').on(table.billingAccountId),
  ],
);

/** billing schema を一括注入したい adapter 向けの table map。 */
export const billingTables = {
  billingAccount,
  billingSubscription,
  billingPaymentIssue,
  billingInvoiceEvent,
  billingEntitlement,
  billingProviderEvent,
  billingOperationAttempt,
  billingAuditEvent,
  billingSignal,
  billingNotification,
  billingDocumentReference,
};

/** `billingTables` の型。利用側の schema 合成で利用する。 */
export type BillingTables = typeof billingTables;
