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
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).default(false).notNull(),
    currentPeriodStart: integer('current_period_start', { mode: 'timestamp_ms' }),
    currentPeriodEnd: integer('current_period_end', { mode: 'timestamp_ms' }),
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
    index('organization_billing_audit_event_org_idx').on(table.organizationId, table.sequenceNumber),
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
    respondedByUserId: text('responded_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    respondedAt: integer('responded_at', { mode: 'timestamp_ms' }),
    acceptedMemberId: text('accepted_member_id').references(() => member.id, { onDelete: 'set null' }),
    acceptedClassroomMemberId: text('accepted_classroom_member_id').references(() => classroomMember.id, {
      onDelete: 'set null',
    }),
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
    index('invitation_audit_log_organization_created_idx').on(table.organizationId, table.createdAt),
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
    uniqueIndex('recurring_schedule_exception_unique_date_uidx').on(table.recurringScheduleId, table.date),
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
    index('slot_organization_start_status_idx').on(table.organizationId, table.startAt, table.status),
    index('slot_organization_service_start_idx').on(table.organizationId, table.serviceId, table.startAt),
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
    cancelledByUserId: text('cancelled_by_user_id').references(() => user.id, { onDelete: 'set null' }),
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
    index('booking_org_participant_created_idx').on(table.organizationId, table.participantId, table.createdAt),
    index('booking_org_service_created_idx').on(table.organizationId, table.serviceId, table.createdAt),
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
    index('ticket_pack_org_participant_status_idx').on(table.organizationId, table.participantId, table.status),
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
    approvedByUserId: text('approved_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    rejectedByUserId: text('rejected_by_user_id').references(() => user.id, { onDelete: 'set null' }),
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
}));

export const organizationBillingRelations = relations(organizationBilling, ({ one }) => ({
  organization: one(organization, {
    fields: [organizationBilling.organizationId],
    references: [organization.id],
  }),
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

export const recurringScheduleExceptionRelations = relations(recurringScheduleException, ({ one }) => ({
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
}));

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
