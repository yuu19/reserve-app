import { relations, sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

const defaultTimestampMs = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull();

const defaultUpdatedTimestampMs = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull();

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id'),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const organization = sqliteTable(
  'organization',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    logo: text('logo'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    metadata: text('metadata'),
  },
  (table) => [uniqueIndex('organization_slug_uidx').on(table.slug)],
);

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

export const billingPaymentIssueEvent = sqliteTable(
  'billing_payment_issue_event',
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
    index('billing_payment_issue_event_account_created_idx').on(
      table.billingAccountId,
      table.createdAt,
    ),
    uniqueIndex('billing_payment_issue_event_provider_uidx').on(
      table.provider,
      table.providerEventId,
      table.eventType,
    ),
  ],
);

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
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
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
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
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
    index('billing_audit_event_account_sequence_idx').on(
      table.billingAccountId,
      table.sequenceNumber,
    ),
  ],
);

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
    index('billing_signal_account_sequence_idx').on(table.billingAccountId, table.sequenceNumber),
  ],
);

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
    recipientUserId: text('recipient_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
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
    index('billing_notification_dedupe_idx').on(
      table.billingAccountId,
      table.notificationKind,
      table.recipientEmail,
      table.providerEventId,
    ),
    index('billing_notification_account_sequence_idx').on(
      table.billingAccountId,
      table.sequenceNumber,
    ),
    index('billing_notification_retry_idx').on(table.notificationKind, table.deliveryStatus),
  ],
);

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

export const stripeWebhookEvent = sqliteTable(
  'stripe_webhook_event',
  {
    id: text('id').primaryKey(),
    eventType: text('event_type').notNull(),
    scope: text('scope').notNull(),
    processingStatus: text('processing_status').default('processing').notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    failureReason: text('failure_reason'),
    signatureVerificationStatus: text('signature_verification_status')
      .default('verified')
      .notNull(),
    duplicateDetected: integer('duplicate_detected', { mode: 'boolean' }).default(false).notNull(),
    duplicateDetectedAt: integer('duplicate_detected_at', { mode: 'timestamp_ms' }),
    receiptStatus: text('receipt_status').default('accepted').notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('stripe_webhook_event_scope_idx').on(table.scope),
    index('stripe_webhook_event_organization_idx').on(table.organizationId),
    index('stripe_webhook_event_subscription_idx').on(table.stripeSubscriptionId),
  ],
);

export const stripeWebhookFailure = sqliteTable(
  'stripe_webhook_failure',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id'),
    eventType: text('event_type'),
    scope: text('scope').notNull(),
    failureStage: text('failure_stage').notNull(),
    failureReason: text('failure_reason').notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('stripe_webhook_failure_event_idx').on(table.eventId),
    index('stripe_webhook_failure_scope_idx').on(table.scope),
    index('stripe_webhook_failure_organization_idx').on(table.organizationId),
  ],
);

export const classroom = sqliteTable(
  'classroom',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('classroom_organization_created_idx').on(table.organizationId, table.createdAt),
    uniqueIndex('classroom_organization_slug_uidx').on(table.organizationId, table.slug),
  ],
);

export const classroomMember = sqliteTable(
  'classroom_member',
  {
    id: text('id').primaryKey(),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classroom.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').default('staff').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('classroom_member_classroom_idx').on(table.classroomId),
    index('classroom_member_user_idx').on(table.userId),
    uniqueIndex('classroom_member_classroom_user_uidx').on(table.classroomId, table.userId),
  ],
);

export const member = sqliteTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').default('member').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('member_organizationId_idx').on(table.organizationId),
    index('member_userId_idx').on(table.userId),
  ],
);

export const participant = sqliteTable(
  'participant',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classroom.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('participant_organization_created_idx').on(table.organizationId, table.createdAt),
    uniqueIndex('participant_organization_classroom_user_uidx').on(
      table.organizationId,
      table.classroomId,
      table.userId,
    ),
    uniqueIndex('participant_organization_classroom_email_uidx').on(
      table.organizationId,
      table.classroomId,
      table.email,
    ),
  ],
);

export const invitation = sqliteTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    subjectKind: text('subject_kind').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id').references(() => classroom.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    principalKind: text('principal_kind').notNull(),
    participantName: text('participant_name'),
    status: text('status').default('pending').notNull(),
    respondedByUserId: text('responded_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    respondedAt: integer('responded_at', { mode: 'timestamp_ms' }),
    acceptedMemberId: text('accepted_member_id').references(() => member.id, {
      onDelete: 'set null',
    }),
    acceptedClassroomMemberId: text('accepted_classroom_member_id').references(
      () => classroomMember.id,
      {
        onDelete: 'set null',
      },
    ),
    acceptedParticipantId: text('accepted_participant_id').references(() => participant.id, {
      onDelete: 'set null',
    }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    invitedByUserId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitation_organizationId_idx').on(table.organizationId),
    index('invitation_subject_kind_status_idx').on(table.subjectKind, table.status),
    index('invitation_organization_classroom_status_idx').on(
      table.organizationId,
      table.classroomId,
      table.status,
    ),
    index('invitation_organization_subject_role_status_idx').on(
      table.organizationId,
      table.subjectKind,
      table.role,
      table.status,
    ),
    index('invitation_email_idx').on(table.email),
  ],
);

export const classroomInvitation = invitation;
export const participantInvitation = invitation;

export const invitationAuditLog = sqliteTable(
  'invitation_audit_log',
  {
    id: text('id').primaryKey(),
    invitationId: text('invitation_id')
      .notNull()
      .references(() => invitation.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id').references(() => classroom.id, { onDelete: 'set null' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    targetEmail: text('target_email').notNull(),
    eventType: text('action').notNull(),
    metadata: text('metadata'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('invitation_audit_log_invitation_action_idx').on(table.invitationId, table.eventType),
    index('invitation_audit_log_organization_created_idx').on(
      table.organizationId,
      table.createdAt,
    ),
    index('invitation_audit_log_actor_created_idx').on(table.actorUserId, table.createdAt),
  ],
);

export const classroomInvitationAuditLog = invitationAuditLog;
export const participantInvitationAuditLog = invitationAuditLog;

export const service = sqliteTable(
  'service',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classroom.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    kind: text('kind').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    capacity: integer('capacity').notNull(),
    bookingOpenMinutesBefore: integer('booking_open_minutes_before'),
    bookingCloseMinutesBefore: integer('booking_close_minutes_before'),
    cancellationDeadlineMinutes: integer('cancellation_deadline_minutes'),
    timezone: text('timezone').default('Asia/Tokyo').notNull(),
    bookingPolicy: text('booking_policy').default('instant').notNull(),
    requiresTicket: integer('requires_ticket', { mode: 'boolean' }).default(false).notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('service_organization_active_idx').on(table.organizationId, table.isActive),
    index('service_organization_kind_idx').on(table.organizationId, table.kind),
  ],
);

export const recurringSchedule = sqliteTable(
  'recurring_schedule',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classroom.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => service.id, { onDelete: 'cascade' }),
    timezone: text('timezone').default('Asia/Tokyo').notNull(),
    frequency: text('frequency').notNull(),
    interval: integer('interval').default(1).notNull(),
    byWeekdayJson: text('by_weekday_json'),
    byMonthday: integer('by_monthday'),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    startTimeLocal: text('start_time_local').notNull(),
    durationMinutes: integer('duration_minutes'),
    capacityOverride: integer('capacity_override'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
    lastGeneratedAt: integer('last_generated_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('recurring_schedule_org_service_active_idx').on(
      table.organizationId,
      table.serviceId,
      table.isActive,
    ),
  ],
);

export const recurringScheduleException = sqliteTable(
  'recurring_schedule_exception',
  {
    id: text('id').primaryKey(),
    recurringScheduleId: text('recurring_schedule_id')
      .notNull()
      .references(() => recurringSchedule.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classroom.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    action: text('action').notNull(),
    overrideStartTimeLocal: text('override_start_time_local'),
    overrideDurationMinutes: integer('override_duration_minutes'),
    overrideCapacity: integer('override_capacity'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('recurring_schedule_exception_unique_date_uidx').on(
      table.recurringScheduleId,
      table.date,
    ),
    index('recurring_schedule_exception_org_date_idx').on(table.organizationId, table.date),
  ],
);

export const slot = sqliteTable(
  'slot',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classroom.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => service.id, { onDelete: 'cascade' }),
    recurringScheduleId: text('recurring_schedule_id').references(() => recurringSchedule.id, {
      onDelete: 'set null',
    }),
    startAt: integer('start_at', { mode: 'timestamp_ms' }).notNull(),
    endAt: integer('end_at', { mode: 'timestamp_ms' }).notNull(),
    capacity: integer('capacity').notNull(),
    reservedCount: integer('reserved_count').default(0).notNull(),
    status: text('status').default('open').notNull(),
    staffLabel: text('staff_label'),
    locationLabel: text('location_label'),
    bookingOpenAt: integer('booking_open_at', { mode: 'timestamp_ms' }).notNull(),
    bookingCloseAt: integer('booking_close_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('slot_recurring_start_uidx').on(
      table.organizationId,
      table.recurringScheduleId,
      table.startAt,
    ),
    index('slot_organization_start_status_idx').on(
      table.organizationId,
      table.startAt,
      table.status,
    ),
    index('slot_organization_service_start_idx').on(
      table.organizationId,
      table.serviceId,
      table.startAt,
    ),
  ],
);

export const booking = sqliteTable(
  'booking',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classroom.id, { onDelete: 'cascade' }),
    slotId: text('slot_id')
      .notNull()
      .references(() => slot.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => service.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => participant.id, { onDelete: 'cascade' }),
    participantsCount: integer('participants_count').default(1).notNull(),
    status: text('status').default('confirmed').notNull(),
    cancelReason: text('cancel_reason'),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    cancelledByUserId: text('cancelled_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    noShowMarkedAt: integer('no_show_marked_at', { mode: 'timestamp_ms' }),
    ticketPackId: text('ticket_pack_id').references(() => ticketPack.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('booking_slot_participant_uidx').on(table.slotId, table.participantId),
    index('booking_org_participant_created_idx').on(
      table.organizationId,
      table.participantId,
      table.createdAt,
    ),
    index('booking_org_service_created_idx').on(
      table.organizationId,
      table.serviceId,
      table.createdAt,
    ),
    index('booking_org_status_created_idx').on(table.organizationId, table.status, table.createdAt),
  ],
);

export const ticketType = sqliteTable(
  'ticket_type',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classroom.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    serviceIdsJson: text('service_ids_json'),
    totalCount: integer('total_count').notNull(),
    expiresInDays: integer('expires_in_days'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
    isForSale: integer('is_for_sale', { mode: 'boolean' }).default(false).notNull(),
    stripePriceId: text('stripe_price_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('ticket_type_org_active_idx').on(table.organizationId, table.isActive)],
);

export const ticketPack = sqliteTable(
  'ticket_pack',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classroom.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => participant.id, { onDelete: 'cascade' }),
    ticketTypeId: text('ticket_type_id')
      .notNull()
      .references(() => ticketType.id, { onDelete: 'cascade' }),
    initialCount: integer('initial_count').notNull(),
    remainingCount: integer('remaining_count').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    status: text('status').default('active').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('ticket_pack_org_participant_status_idx').on(
      table.organizationId,
      table.participantId,
      table.status,
    ),
    index('ticket_pack_org_expires_idx').on(table.organizationId, table.expiresAt),
  ],
);

export const ticketPurchase = sqliteTable(
  'ticket_purchase',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classroom.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => participant.id, { onDelete: 'cascade' }),
    ticketTypeId: text('ticket_type_id')
      .notNull()
      .references(() => ticketType.id, { onDelete: 'cascade' }),
    paymentMethod: text('payment_method').notNull(),
    status: text('status').notNull(),
    ticketPackId: text('ticket_pack_id').references(() => ticketPack.id, { onDelete: 'set null' }),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    approvedByUserId: text('approved_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    rejectedByUserId: text('rejected_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    rejectedAt: integer('rejected_at', { mode: 'timestamp_ms' }),
    rejectReason: text('reject_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('ticket_purchase_org_status_created_idx').on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    index('ticket_purchase_org_participant_created_idx').on(
      table.organizationId,
      table.participantId,
      table.createdAt,
    ),
    uniqueIndex('ticket_purchase_stripe_checkout_session_uidx').on(table.stripeCheckoutSessionId),
  ],
);

export const ticketLedger = sqliteTable(
  'ticket_ledger',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classroom.id, { onDelete: 'cascade' }),
    ticketPackId: text('ticket_pack_id')
      .notNull()
      .references(() => ticketPack.id, { onDelete: 'cascade' }),
    bookingId: text('booking_id').references(() => booking.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    reason: text('reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('ticket_ledger_pack_created_idx').on(table.ticketPackId, table.createdAt),
    index('ticket_ledger_org_created_idx').on(table.organizationId, table.createdAt),
  ],
);

export const bookingAuditLog = sqliteTable(
  'booking_audit_log',
  {
    id: text('id').primaryKey(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classroom.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    metadata: text('metadata'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('booking_audit_log_booking_action_idx').on(table.bookingId, table.action),
    index('booking_audit_log_org_created_idx').on(table.organizationId, table.createdAt),
  ],
);

export const aiKnowledgeDocument = sqliteTable(
  'ai_knowledge_document',
  {
    id: text('id').primaryKey(),
    sourceKind: text('source_kind').notNull(),
    sourcePath: text('source_path').notNull(),
    title: text('title').notNull(),
    locale: text('locale').default('ja').notNull(),
    visibility: text('visibility').default('authenticated').notNull(),
    internalOnly: integer('internal_only', { mode: 'boolean' }).default(false).notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    classroomId: text('classroom_id').references(() => classroom.id, {
      onDelete: 'cascade',
    }),
    feature: text('feature'),
    checksum: text('checksum').notNull(),
    indexStatus: text('index_status').default('pending').notNull(),
    indexedAt: integer('indexed_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('ai_knowledge_document_source_idx').on(table.sourceKind, table.sourcePath),
    index('ai_knowledge_document_status_idx').on(table.indexStatus, table.indexedAt),
    index('ai_knowledge_document_scope_idx').on(
      table.organizationId,
      table.classroomId,
      table.visibility,
    ),
    uniqueIndex('ai_knowledge_document_source_uidx').on(
      table.sourceKind,
      table.sourcePath,
      table.organizationId,
      table.classroomId,
    ),
  ],
);

export const aiKnowledgeChunk = sqliteTable(
  'ai_knowledge_chunk',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => aiKnowledgeDocument.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    title: text('title').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourcePath: text('source_path').notNull(),
    locale: text('locale').default('ja').notNull(),
    visibility: text('visibility').default('authenticated').notNull(),
    internalOnly: integer('internal_only', { mode: 'boolean' }).default(false).notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    classroomId: text('classroom_id').references(() => classroom.id, {
      onDelete: 'cascade',
    }),
    feature: text('feature'),
    tagsJson: text('tags_json'),
    indexedAt: integer('indexed_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    vectorStatus: text('vector_status').default('pending').notNull(),
  },
  (table) => [
    index('ai_knowledge_chunk_document_idx').on(table.documentId, table.chunkIndex),
    index('ai_knowledge_chunk_lookup_idx').on(
      table.locale,
      table.visibility,
      table.organizationId,
      table.classroomId,
    ),
    index('ai_knowledge_chunk_vector_status_idx').on(table.vectorStatus, table.indexedAt),
    uniqueIndex('ai_knowledge_chunk_document_hash_uidx').on(table.documentId, table.contentHash),
  ],
);

export const aiKnowledgeIndexRun = sqliteTable(
  'ai_knowledge_index_run',
  {
    id: text('id').primaryKey(),
    sourceRoot: text('source_root').notNull(),
    status: text('status').default('running').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    documentsSeen: integer('documents_seen').default(0).notNull(),
    documentsIndexed: integer('documents_indexed').default(0).notNull(),
    chunksUpserted: integer('chunks_upserted').default(0).notNull(),
    chunksFailed: integer('chunks_failed').default(0).notNull(),
    embeddingModel: text('embedding_model').notNull(),
    embeddingShapeJson: text('embedding_shape_json'),
    vectorIndexName: text('vector_index_name').notNull(),
    errorSummary: text('error_summary'),
  },
  (table) => [
    index('ai_knowledge_index_run_source_status_idx').on(
      table.sourceRoot,
      table.status,
      table.startedAt,
    ),
  ],
);

export const aiConversation = sqliteTable(
  'ai_conversation',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    classroomId: text('classroom_id').references(() => classroom.id, {
      onDelete: 'cascade',
    }),
    title: text('title'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    retentionExpiresAt: integer('retention_expires_at', { mode: 'timestamp_ms' }).notNull(),
    anonymizedAt: integer('anonymized_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('ai_conversation_user_scope_idx').on(
      table.userId,
      table.organizationId,
      table.classroomId,
      table.updatedAt,
    ),
    index('ai_conversation_retention_idx').on(table.retentionExpiresAt, table.anonymizedAt),
  ],
);

export const aiMessage = sqliteTable(
  'ai_message',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => aiConversation.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    sourcesJson: text('sources_json'),
    retrievedContextJson: text('retrieved_context_json'),
    confidence: integer('confidence'),
    needsHumanSupport: integer('needs_human_support', { mode: 'boolean' }).default(false).notNull(),
    aiGatewayLogId: text('ai_gateway_log_id'),
    aiModel: text('ai_model'),
    aiLatencyMs: integer('ai_latency_ms'),
    aiGenerationStatus: text('ai_generation_status'),
    aiErrorSummary: text('ai_error_summary'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    retentionExpiresAt: integer('retention_expires_at', { mode: 'timestamp_ms' }).notNull(),
    anonymizedAt: integer('anonymized_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('ai_message_conversation_created_idx').on(table.conversationId, table.createdAt),
    index('ai_message_retention_idx').on(table.retentionExpiresAt, table.anonymizedAt),
  ],
);

export const aiFeedback = sqliteTable(
  'ai_feedback',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => aiMessage.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    rating: text('rating').notNull(),
    comment: text('comment'),
    resolved: integer('resolved', { mode: 'boolean' }).default(false).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    aggregateRetentionExpiresAt: integer('aggregate_retention_expires_at', {
      mode: 'timestamp_ms',
    }).notNull(),
  },
  (table) => [
    index('ai_feedback_message_idx').on(table.messageId),
    index('ai_feedback_rating_created_idx').on(table.rating, table.createdAt),
    index('ai_feedback_retention_idx').on(table.aggregateRetentionExpiresAt),
    uniqueIndex('ai_feedback_message_user_uidx').on(table.messageId, table.userId),
  ],
);

export const aiUsageCounter = sqliteTable(
  'ai_usage_counter',
  {
    id: text('id').primaryKey(),
    scopeKind: text('scope_kind').notNull(),
    scopeId: text('scope_id').notNull(),
    windowKind: text('window_kind').notNull(),
    windowStartAt: integer('window_start_at', { mode: 'timestamp_ms' }).notNull(),
    count: integer('count').default(0).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('ai_usage_counter_window_uidx').on(
      table.scopeKind,
      table.scopeId,
      table.windowKind,
      table.windowStartAt,
    ),
    index('ai_usage_counter_expiry_idx').on(table.windowKind, table.windowStartAt),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  classroomMembers: many(classroomMember),
  participants: many(participant),
  invitations: many(invitation),
  invitationAuditLogs: many(invitationAuditLog),
  bookingsCancelledBy: many(booking),
  ticketLedgers: many(ticketLedger),
  ticketPurchasesApproved: many(ticketPurchase, {
    relationName: 'ticketPurchaseApprovedBy',
  }),
  ticketPurchasesRejected: many(ticketPurchase, {
    relationName: 'ticketPurchaseRejectedBy',
  }),
  bookingAuditLogs: many(bookingAuditLog),
  aiConversations: many(aiConversation),
  aiFeedback: many(aiFeedback),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const aiKnowledgeDocumentRelations = relations(aiKnowledgeDocument, ({ one, many }) => ({
  organization: one(organization, {
    fields: [aiKnowledgeDocument.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [aiKnowledgeDocument.classroomId],
    references: [classroom.id],
  }),
  chunks: many(aiKnowledgeChunk),
}));

export const aiKnowledgeChunkRelations = relations(aiKnowledgeChunk, ({ one }) => ({
  document: one(aiKnowledgeDocument, {
    fields: [aiKnowledgeChunk.documentId],
    references: [aiKnowledgeDocument.id],
  }),
  organization: one(organization, {
    fields: [aiKnowledgeChunk.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [aiKnowledgeChunk.classroomId],
    references: [classroom.id],
  }),
}));

export const aiConversationRelations = relations(aiConversation, ({ one, many }) => ({
  user: one(user, {
    fields: [aiConversation.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [aiConversation.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [aiConversation.classroomId],
    references: [classroom.id],
  }),
  messages: many(aiMessage),
}));

export const aiMessageRelations = relations(aiMessage, ({ one, many }) => ({
  conversation: one(aiConversation, {
    fields: [aiMessage.conversationId],
    references: [aiConversation.id],
  }),
  feedback: many(aiFeedback),
}));

export const aiFeedbackRelations = relations(aiFeedback, ({ one }) => ({
  message: one(aiMessage, {
    fields: [aiFeedback.messageId],
    references: [aiMessage.id],
  }),
  user: one(user, {
    fields: [aiFeedback.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  classrooms: many(classroom),
  participants: many(participant),
  services: many(service),
  recurringSchedules: many(recurringSchedule),
  recurringScheduleExceptions: many(recurringScheduleException),
  slots: many(slot),
  bookings: many(booking),
  ticketTypes: many(ticketType),
  ticketPacks: many(ticketPack),
  ticketPurchases: many(ticketPurchase),
  ticketLedgers: many(ticketLedger),
  bookingAuditLogs: many(bookingAuditLog),
  invitations: many(invitation),
  invitationAuditLogs: many(invitationAuditLog),
  aiKnowledgeDocuments: many(aiKnowledgeDocument),
  aiKnowledgeChunks: many(aiKnowledgeChunk),
  aiConversations: many(aiConversation),
}));

export const classroomRelations = relations(classroom, ({ one, many }) => ({
  organization: one(organization, {
    fields: [classroom.organizationId],
    references: [organization.id],
  }),
  members: many(classroomMember),
  participants: many(participant),
  services: many(service),
  recurringSchedules: many(recurringSchedule),
  recurringScheduleExceptions: many(recurringScheduleException),
  slots: many(slot),
  bookings: many(booking),
  ticketTypes: many(ticketType),
  ticketPacks: many(ticketPack),
  ticketPurchases: many(ticketPurchase),
  ticketLedgers: many(ticketLedger),
  bookingAuditLogs: many(bookingAuditLog),
  invitations: many(invitation),
  invitationAuditLogs: many(invitationAuditLog),
  aiKnowledgeDocuments: many(aiKnowledgeDocument),
  aiKnowledgeChunks: many(aiKnowledgeChunk),
  aiConversations: many(aiConversation),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const classroomMemberRelations = relations(classroomMember, ({ one }) => ({
  classroom: one(classroom, {
    fields: [classroomMember.classroomId],
    references: [classroom.id],
  }),
  user: one(user, {
    fields: [classroomMember.userId],
    references: [user.id],
  }),
}));

export const participantRelations = relations(participant, ({ one, many }) => ({
  organization: one(organization, {
    fields: [participant.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [participant.classroomId],
    references: [classroom.id],
  }),
  user: one(user, {
    fields: [participant.userId],
    references: [user.id],
  }),
  bookings: many(booking),
  ticketPacks: many(ticketPack),
  ticketPurchases: many(ticketPurchase),
}));

export const serviceRelations = relations(service, ({ one, many }) => ({
  organization: one(organization, {
    fields: [service.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [service.classroomId],
    references: [classroom.id],
  }),
  recurringSchedules: many(recurringSchedule),
  slots: many(slot),
  bookings: many(booking),
}));

export const recurringScheduleRelations = relations(recurringSchedule, ({ one, many }) => ({
  organization: one(organization, {
    fields: [recurringSchedule.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [recurringSchedule.classroomId],
    references: [classroom.id],
  }),
  service: one(service, {
    fields: [recurringSchedule.serviceId],
    references: [service.id],
  }),
  exceptions: many(recurringScheduleException),
  slots: many(slot),
}));

export const recurringScheduleExceptionRelations = relations(
  recurringScheduleException,
  ({ one }) => ({
    organization: one(organization, {
      fields: [recurringScheduleException.organizationId],
      references: [organization.id],
    }),
    classroom: one(classroom, {
      fields: [recurringScheduleException.classroomId],
      references: [classroom.id],
    }),
    recurringSchedule: one(recurringSchedule, {
      fields: [recurringScheduleException.recurringScheduleId],
      references: [recurringSchedule.id],
    }),
  }),
);

export const slotRelations = relations(slot, ({ one, many }) => ({
  organization: one(organization, {
    fields: [slot.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [slot.classroomId],
    references: [classroom.id],
  }),
  service: one(service, {
    fields: [slot.serviceId],
    references: [service.id],
  }),
  recurringSchedule: one(recurringSchedule, {
    fields: [slot.recurringScheduleId],
    references: [recurringSchedule.id],
  }),
  bookings: many(booking),
}));

export const bookingRelations = relations(booking, ({ one, many }) => ({
  organization: one(organization, {
    fields: [booking.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [booking.classroomId],
    references: [classroom.id],
  }),
  slot: one(slot, {
    fields: [booking.slotId],
    references: [slot.id],
  }),
  service: one(service, {
    fields: [booking.serviceId],
    references: [service.id],
  }),
  participant: one(participant, {
    fields: [booking.participantId],
    references: [participant.id],
  }),
  cancelledByUser: one(user, {
    fields: [booking.cancelledByUserId],
    references: [user.id],
  }),
  ticketPack: one(ticketPack, {
    fields: [booking.ticketPackId],
    references: [ticketPack.id],
  }),
  ticketLedgers: many(ticketLedger),
  auditLogs: many(bookingAuditLog),
}));

export const ticketTypeRelations = relations(ticketType, ({ one, many }) => ({
  organization: one(organization, {
    fields: [ticketType.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [ticketType.classroomId],
    references: [classroom.id],
  }),
  ticketPacks: many(ticketPack),
  ticketPurchases: many(ticketPurchase),
}));

export const ticketPackRelations = relations(ticketPack, ({ one, many }) => ({
  organization: one(organization, {
    fields: [ticketPack.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [ticketPack.classroomId],
    references: [classroom.id],
  }),
  participant: one(participant, {
    fields: [ticketPack.participantId],
    references: [participant.id],
  }),
  ticketType: one(ticketType, {
    fields: [ticketPack.ticketTypeId],
    references: [ticketType.id],
  }),
  ticketPurchases: many(ticketPurchase),
  ticketLedgers: many(ticketLedger),
}));

export const ticketPurchaseRelations = relations(ticketPurchase, ({ one }) => ({
  organization: one(organization, {
    fields: [ticketPurchase.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [ticketPurchase.classroomId],
    references: [classroom.id],
  }),
  participant: one(participant, {
    fields: [ticketPurchase.participantId],
    references: [participant.id],
  }),
  ticketType: one(ticketType, {
    fields: [ticketPurchase.ticketTypeId],
    references: [ticketType.id],
  }),
  ticketPack: one(ticketPack, {
    fields: [ticketPurchase.ticketPackId],
    references: [ticketPack.id],
  }),
  approvedByUser: one(user, {
    relationName: 'ticketPurchaseApprovedBy',
    fields: [ticketPurchase.approvedByUserId],
    references: [user.id],
  }),
  rejectedByUser: one(user, {
    relationName: 'ticketPurchaseRejectedBy',
    fields: [ticketPurchase.rejectedByUserId],
    references: [user.id],
  }),
}));

export const ticketLedgerRelations = relations(ticketLedger, ({ one }) => ({
  organization: one(organization, {
    fields: [ticketLedger.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [ticketLedger.classroomId],
    references: [classroom.id],
  }),
  ticketPack: one(ticketPack, {
    fields: [ticketLedger.ticketPackId],
    references: [ticketPack.id],
  }),
  booking: one(booking, {
    fields: [ticketLedger.bookingId],
    references: [booking.id],
  }),
  actor: one(user, {
    fields: [ticketLedger.actorUserId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [invitation.classroomId],
    references: [classroom.id],
  }),
  invitedByUser: one(user, {
    fields: [invitation.invitedByUserId],
    references: [user.id],
  }),
  respondedByUser: one(user, {
    fields: [invitation.respondedByUserId],
    references: [user.id],
  }),
  acceptedMember: one(member, {
    fields: [invitation.acceptedMemberId],
    references: [member.id],
  }),
  acceptedClassroomMember: one(classroomMember, {
    fields: [invitation.acceptedClassroomMemberId],
    references: [classroomMember.id],
  }),
  acceptedParticipant: one(participant, {
    fields: [invitation.acceptedParticipantId],
    references: [participant.id],
  }),
}));

export const invitationAuditLogRelations = relations(invitationAuditLog, ({ one }) => ({
  invitation: one(invitation, {
    fields: [invitationAuditLog.invitationId],
    references: [invitation.id],
  }),
  organization: one(organization, {
    fields: [invitationAuditLog.organizationId],
    references: [organization.id],
  }),
  classroom: one(classroom, {
    fields: [invitationAuditLog.classroomId],
    references: [classroom.id],
  }),
  actor: one(user, {
    fields: [invitationAuditLog.actorUserId],
    references: [user.id],
  }),
}));
