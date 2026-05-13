import { relations, sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

export const organizationBilling = sqliteTable(
  'organization_billing',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    planCode: text('plan_code').default('free').notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripePriceId: text('stripe_price_id'),
    billingInterval: text('billing_interval'),
    subscriptionStatus: text('subscription_status').default('free').notNull(),
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' })
      .default(false)
      .notNull(),
    trialStartedAt: integer('trial_started_at', { mode: 'timestamp_ms' }),
    trialEndedAt: integer('trial_ended_at', { mode: 'timestamp_ms' }),
    currentPeriodStart: integer('current_period_start', { mode: 'timestamp_ms' }),
    currentPeriodEnd: integer('current_period_end', { mode: 'timestamp_ms' }),
    paymentIssueStartedAt: integer('payment_issue_started_at', { mode: 'timestamp_ms' }),
    pastDueGraceEndsAt: integer('past_due_grace_ends_at', { mode: 'timestamp_ms' }),
    billingProfileReadiness: text('billing_profile_readiness').default('not_required').notNull(),
    billingProfileNextAction: text('billing_profile_next_action'),
    billingProfileCheckedAt: integer('billing_profile_checked_at', { mode: 'timestamp_ms' }),
    lastReconciledAt: integer('last_reconciled_at', { mode: 'timestamp_ms' }),
    lastReconciliationReason: text('last_reconciliation_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('organization_billing_organization_uidx').on(table.organizationId),
    uniqueIndex('organization_billing_stripe_customer_uidx').on(table.stripeCustomerId),
    uniqueIndex('organization_billing_stripe_subscription_uidx').on(table.stripeSubscriptionId),
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

export const organizationBillingOperationAttempt = sqliteTable(
  'organization_billing_operation_attempt',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    billingInterval: text('billing_interval'),
    state: text('state').default('processing').notNull(),
    handoffUrl: text('handoff_url'),
    handoffExpiresAt: integer('handoff_expires_at', { mode: 'timestamp_ms' }),
    provider: text('provider').default('stripe').notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePortalSessionId: text('stripe_portal_session_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    failureReason: text('failure_reason'),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('organization_billing_operation_attempt_org_idx').on(
      table.organizationId,
      table.purpose,
      table.billingInterval,
      table.state,
    ),
    index('organization_billing_operation_attempt_handoff_idx').on(
      table.organizationId,
      table.purpose,
      table.handoffExpiresAt,
    ),
    uniqueIndex('organization_billing_operation_attempt_idempotency_uidx').on(table.idempotencyKey),
  ],
);

export const organizationBillingInvoiceEvent = sqliteTable(
  'organization_billing_invoice_event',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    stripeEventId: text('stripe_event_id'),
    eventType: text('event_type').notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeInvoiceId: text('stripe_invoice_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    providerStatus: text('provider_status'),
    ownerFacingStatus: text('owner_facing_status').notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('organization_billing_invoice_event_org_idx').on(table.organizationId, table.createdAt),
    uniqueIndex('organization_billing_invoice_event_provider_uidx').on(
      table.stripeEventId,
      table.eventType,
    ),
  ],
);

export const organizationBillingDocumentReference = sqliteTable(
  'organization_billing_document_reference',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    invoiceEventId: text('invoice_event_id').references(() => organizationBillingInvoiceEvent.id, {
      onDelete: 'set null',
    }),
    documentKind: text('document_kind').notNull(),
    providerDocumentId: text('provider_document_id').notNull(),
    hostedInvoiceUrl: text('hosted_invoice_url'),
    invoicePdfUrl: text('invoice_pdf_url'),
    receiptUrl: text('receipt_url'),
    availability: text('availability').notNull(),
    ownerFacingStatus: text('owner_facing_status').notNull(),
    providerDerived: integer('provider_derived', { mode: 'boolean' }).default(true).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('organization_billing_document_reference_org_idx').on(
      table.organizationId,
      table.documentKind,
      table.availability,
    ),
    uniqueIndex('organization_billing_document_reference_provider_uidx').on(
      table.organizationId,
      table.documentKind,
      table.providerDocumentId,
    ),
  ],
);

export const organizationBillingNotification = sqliteTable(
  'organization_billing_notification',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    recipientUserId: text('recipient_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    notificationKind: text('notification_kind').notNull(),
    channel: text('channel').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    deliveryState: text('delivery_state').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    stripeEventId: text('stripe_event_id'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    recipientEmail: text('recipient_email'),
    planState: text('plan_state').notNull(),
    subscriptionStatus: text('subscription_status').notNull(),
    paymentMethodStatus: text('payment_method_status').notNull(),
    trialEndsAt: integer('trial_ends_at', { mode: 'timestamp_ms' }),
    failureReason: text('failure_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('organization_billing_notification_org_idx').on(
      table.organizationId,
      table.sequenceNumber,
    ),
    index('organization_billing_notification_event_idx').on(table.stripeEventId),
    index('organization_billing_notification_recipient_idx').on(table.recipientUserId),
  ],
);

export const organizationBillingAuditEvent = sqliteTable(
  'organization_billing_audit_event',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    sequenceNumber: integer('sequence_number').notNull(),
    sourceKind: text('source_kind').notNull(),
    stripeEventId: text('stripe_event_id'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    sourceContext: text('source_context'),
    previousPlanCode: text('previous_plan_code').notNull(),
    nextPlanCode: text('next_plan_code').notNull(),
    previousPlanState: text('previous_plan_state').notNull(),
    nextPlanState: text('next_plan_state').notNull(),
    previousSubscriptionStatus: text('previous_subscription_status').notNull(),
    nextSubscriptionStatus: text('next_subscription_status').notNull(),
    previousPaymentMethodStatus: text('previous_payment_method_status').notNull(),
    nextPaymentMethodStatus: text('next_payment_method_status').notNull(),
    previousEntitlementState: text('previous_entitlement_state').notNull(),
    nextEntitlementState: text('next_entitlement_state').notNull(),
    previousBillingInterval: text('previous_billing_interval'),
    nextBillingInterval: text('next_billing_interval'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('organization_billing_audit_event_org_idx').on(
      table.organizationId,
      table.sequenceNumber,
    ),
    index('organization_billing_audit_event_event_idx').on(table.stripeEventId),
  ],
);

export const organizationBillingSignal = sqliteTable(
  'organization_billing_signal',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    sequenceNumber: integer('sequence_number').notNull(),
    signalKind: text('signal_kind').notNull(),
    signalStatus: text('signal_status').notNull(),
    sourceKind: text('source_kind').notNull(),
    reason: text('reason').notNull(),
    stripeEventId: text('stripe_event_id'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    providerPlanState: text('provider_plan_state'),
    providerSubscriptionStatus: text('provider_subscription_status'),
    appPlanState: text('app_plan_state').notNull(),
    appSubscriptionStatus: text('app_subscription_status').notNull(),
    appPaymentMethodStatus: text('app_payment_method_status').notNull(),
    appEntitlementState: text('app_entitlement_state').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('organization_billing_signal_org_idx').on(table.organizationId, table.sequenceNumber),
    index('organization_billing_signal_event_idx').on(table.stripeEventId),
    index('organization_billing_signal_kind_idx').on(table.signalKind, table.signalStatus),
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
  billingRecords: many(organizationBilling),
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
  billingOperationAttempts: many(organizationBillingOperationAttempt),
  billingInvoiceEvents: many(organizationBillingInvoiceEvent),
  billingDocumentReferences: many(organizationBillingDocumentReference),
  aiKnowledgeDocuments: many(aiKnowledgeDocument),
  aiKnowledgeChunks: many(aiKnowledgeChunk),
  aiConversations: many(aiConversation),
}));

export const organizationBillingRelations = relations(organizationBilling, ({ one }) => ({
  organization: one(organization, {
    fields: [organizationBilling.organizationId],
    references: [organization.id],
  }),
}));

export const organizationBillingOperationAttemptRelations = relations(
  organizationBillingOperationAttempt,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationBillingOperationAttempt.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [organizationBillingOperationAttempt.createdByUserId],
      references: [user.id],
    }),
  }),
);

export const organizationBillingInvoiceEventRelations = relations(
  organizationBillingInvoiceEvent,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [organizationBillingInvoiceEvent.organizationId],
      references: [organization.id],
    }),
    documentReferences: many(organizationBillingDocumentReference),
  }),
);

export const organizationBillingDocumentReferenceRelations = relations(
  organizationBillingDocumentReference,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationBillingDocumentReference.organizationId],
      references: [organization.id],
    }),
    invoiceEvent: one(organizationBillingInvoiceEvent, {
      fields: [organizationBillingDocumentReference.invoiceEventId],
      references: [organizationBillingInvoiceEvent.id],
    }),
  }),
);

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
