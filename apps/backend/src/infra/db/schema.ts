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

export {
  billingAccount,
  billingAuditEvent,
  billingDocumentReference,
  billingEntitlement,
  billingInvoiceEvent,
  billingNotification,
  billingOperationAttempt,
  billingPaymentIssue,
  billingProviderEvent,
  billingSignal,
  billingSubscription,
  billingTables,
} from '@repo/saas-billing-drizzle/schema';

export const store = sqliteTable(
  'store',
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
    index('store_organization_created_idx').on(table.organizationId, table.createdAt),
    uniqueIndex('store_organization_slug_uidx').on(table.organizationId, table.slug),
  ],
);

export const publicSiteSetting = sqliteTable(
  'public_site_setting',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    siteName: text('site_name'),
    description: text('description'),
    address: text('address'),
    phone: text('phone'),
    businessHours: text('business_hours'),
    imageUrl: text('image_url'),
    status: text('status').default('public').notNull(),
    acceptBookings: integer('accept_bookings', { mode: 'boolean' }).default(true).notNull(),
    noindex: integer('noindex', { mode: 'boolean' }).default(false).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('public_site_setting_store_uidx').on(table.organizationId, table.storeId),
    index('public_site_setting_organization_idx').on(table.organizationId),
  ],
);

export const publicSiteIntakeField = sqliteTable(
  'public_site_intake_field',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    label: text('label').notNull(),
    fieldType: text('field_type').notNull(),
    required: integer('required', { mode: 'boolean' }).default(false).notNull(),
    optionsJson: text('options_json'),
    helpText: text('help_text'),
    placeholder: text('placeholder'),
    visibleOnPublic: integer('visible_on_public', { mode: 'boolean' }).default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    index('public_site_intake_field_store_order_idx').on(
      table.organizationId,
      table.storeId,
      table.sortOrder,
    ),
    uniqueIndex('public_site_intake_field_store_key_uidx').on(
      table.organizationId,
      table.storeId,
      table.fieldKey,
    ),
  ],
);

export const storeMember = sqliteTable(
  'store_member',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').default('staff').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('store_member_store_idx').on(table.storeId),
    index('store_member_user_idx').on(table.userId),
    uniqueIndex('store_member_store_user_uidx').on(table.storeId, table.userId),
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
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
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
    uniqueIndex('participant_organization_store_user_uidx').on(
      table.organizationId,
      table.storeId,
      table.userId,
    ),
    uniqueIndex('participant_organization_store_email_uidx').on(
      table.organizationId,
      table.storeId,
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
    storeId: text('store_id').references(() => store.id, { onDelete: 'set null' }),
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
    acceptedStoreMemberId: text('accepted_store_member_id').references(() => storeMember.id, {
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
    index('invitation_organization_store_status_idx').on(
      table.organizationId,
      table.storeId,
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

export const storeInvitation = invitation;
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
    storeId: text('store_id').references(() => store.id, { onDelete: 'set null' }),
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

export const storeInvitationAuditLog = invitationAuditLog;
export const participantInvitationAuditLog = invitationAuditLog;

export const service = sqliteTable(
  'service',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
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
    publicStatus: text('public_status').default('public').notNull(),
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
    index('service_store_public_status_idx').on(table.storeId, table.publicStatus, table.isActive),
  ],
);

export const recurringSchedule = sqliteTable(
  'recurring_schedule',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
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
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
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
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
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
    publicStatus: text('public_status').default('public').notNull(),
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
    index('slot_store_public_status_idx').on(
      table.storeId,
      table.publicStatus,
      table.status,
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
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    slotId: text('slot_id')
      .notNull()
      .references(() => slot.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => service.id, { onDelete: 'cascade' }),
    participantId: text('participant_id').references(() => participant.id, {
      onDelete: 'set null',
    }),
    publicId: text('public_id'),
    source: text('source').default('participant').notNull(),
    participantsCount: integer('participants_count').default(1).notNull(),
    customerName: text('customer_name'),
    customerEmail: text('customer_email'),
    customerPhone: text('customer_phone'),
    note: text('note'),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    status: text('status').default('confirmed').notNull(),
    cancelReason: text('cancel_reason'),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    cancelledByUserId: text('cancelled_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    noShowMarkedAt: integer('no_show_marked_at', { mode: 'timestamp_ms' }),
    attendanceStatus: text('attendance_status').default('not_checked').notNull(),
    attendanceMarkedAt: integer('attendance_marked_at', { mode: 'timestamp_ms' }),
    attendanceMarkedByUserId: text('attendance_marked_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
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
    uniqueIndex('booking_public_id_uidx').on(table.publicId),
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
    index('booking_org_source_created_idx').on(table.organizationId, table.source, table.createdAt),
  ],
);

export const bookingAnswer = sqliteTable(
  'booking_answer',
  {
    id: text('id').primaryKey(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    fieldId: text('field_id').notNull(),
    labelSnapshot: text('label_snapshot').notNull(),
    valueJson: text('value_json').notNull(),
    createdAt: defaultTimestampMs(),
  },
  (table) => [index('booking_answer_booking_idx').on(table.bookingId)],
);

export const bookingCompanion = sqliteTable(
  'booking_companion',
  {
    id: text('id').primaryKey(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    note: text('note'),
    createdAt: defaultTimestampMs(),
  },
  (table) => [index('booking_companion_booking_idx').on(table.bookingId)],
);

export const bookingPublicActionToken = sqliteTable(
  'booking_public_action_token',
  {
    id: text('id').primaryKey(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    emailSnapshot: text('email_snapshot').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp_ms' }),
    createdAt: defaultTimestampMs(),
  },
  (table) => [
    uniqueIndex('booking_public_action_token_hash_uidx').on(table.tokenHash),
    index('booking_public_action_token_booking_purpose_idx').on(table.bookingId, table.purpose),
  ],
);

export const bookingChangeLog = sqliteTable(
  'booking_change_log',
  {
    id: text('id').primaryKey(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    beforeJson: text('before_json').notNull(),
    afterJson: text('after_json').notNull(),
    reason: text('reason'),
    changedByUserId: text('changed_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: defaultTimestampMs(),
  },
  (table) => [
    index('booking_change_log_booking_created_idx').on(table.bookingId, table.createdAt),
    index('booking_change_log_org_created_idx').on(table.organizationId, table.createdAt),
  ],
);

export const publicSiteNotificationSetting = sqliteTable(
  'public_site_notification_setting',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    notifyOwner: integer('notify_owner', { mode: 'boolean' }).default(true).notNull(),
    notifyAdmins: integer('notify_admins', { mode: 'boolean' }).default(true).notNull(),
    notifyStoreManagers: integer('notify_store_managers', { mode: 'boolean' })
      .default(true)
      .notNull(),
    notifyStaff: integer('notify_staff', { mode: 'boolean' }).default(false).notNull(),
    additionalEmailsJson: text('additional_emails_json'),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('public_site_notification_setting_store_uidx').on(
      table.organizationId,
      table.storeId,
    ),
  ],
);

export const notificationLog = sqliteTable(
  'notification_log',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    bookingId: text('booking_id').references(() => booking.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    channel: text('channel').default('email').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    status: text('status').default('pending').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    errorMessage: text('error_message'),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    uniqueIndex('notification_log_dedupe_uidx').on(table.dedupeKey),
    index('notification_log_booking_event_idx').on(table.bookingId, table.eventType),
    index('notification_log_org_created_idx').on(table.organizationId, table.createdAt),
  ],
);

export const reminderPolicy = sqliteTable(
  'reminder_policy',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    serviceId: text('service_id').references(() => service.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    minutesBefore: integer('minutes_before').default(1440).notNull(),
    channel: text('channel').default('email').notNull(),
    createdAt: defaultTimestampMs(),
    updatedAt: defaultUpdatedTimestampMs(),
  },
  (table) => [
    index('reminder_policy_store_enabled_idx').on(
      table.organizationId,
      table.storeId,
      table.enabled,
    ),
    index('reminder_policy_service_idx').on(table.serviceId),
  ],
);

export const reminderLog = sqliteTable(
  'reminder_log',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    bookingId: text('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    reminderPolicyId: text('reminder_policy_id').references(() => reminderPolicy.id, {
      onDelete: 'set null',
    }),
    channel: text('channel').default('email').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    status: text('status').default('pending').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    errorMessage: text('error_message'),
    scheduledFor: integer('scheduled_for', { mode: 'timestamp_ms' }).notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    createdAt: defaultTimestampMs(),
  },
  (table) => [
    uniqueIndex('reminder_log_dedupe_uidx').on(table.dedupeKey),
    index('reminder_log_booking_idx').on(table.bookingId),
    index('reminder_log_scheduled_status_idx').on(table.scheduledFor, table.status),
  ],
);

export const ticketType = sqliteTable(
  'ticket_type',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
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
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => participant.id, { onDelete: 'cascade' }),
    ticketTypeId: text('ticket_type_id')
      .notNull()
      .references(() => ticketType.id, { onDelete: 'cascade' }),
    serviceIdsJson: text('service_ids_json'),
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
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => participant.id, { onDelete: 'cascade' }),
    ticketTypeId: text('ticket_type_id')
      .notNull()
      .references(() => ticketType.id, { onDelete: 'cascade' }),
    serviceIdsJson: text('service_ids_json'),
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
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
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
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
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
    storeId: text('store_id').references(() => store.id, {
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
      table.storeId,
      table.visibility,
    ),
    uniqueIndex('ai_knowledge_document_source_uidx').on(
      table.sourceKind,
      table.sourcePath,
      table.organizationId,
      table.storeId,
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
    storeId: text('store_id').references(() => store.id, {
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
      table.storeId,
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
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    storeId: text('store_id').references(() => store.id, {
      onDelete: 'cascade',
    }),
    channel: text('channel').default('web').notNull(),
    status: text('status').default('active').notNull(),
    title: text('title'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    lastMessageAt: integer('last_message_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    retentionExpiresAt: integer('retention_expires_at', { mode: 'timestamp_ms' }).notNull(),
    anonymizedAt: integer('anonymized_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('ai_conversation_actor_subject_idx').on(
      table.actorUserId,
      table.subjectType,
      table.subjectId,
      table.storeId,
      table.updatedAt,
    ),
    index('ai_conversation_subject_status_last_message_idx').on(
      table.subjectType,
      table.subjectId,
      table.status,
      table.lastMessageAt,
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
    provider: text('provider'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    generationStatus: text('generation_status'),
    errorCode: text('error_code'),
    errorSummary: text('error_summary'),
    aiGatewayLogId: text('ai_gateway_log_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    retentionExpiresAt: integer('retention_expires_at', { mode: 'timestamp_ms' }).notNull(),
    anonymizedAt: integer('anonymized_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('ai_message_conversation_created_idx').on(table.conversationId, table.createdAt),
    index('ai_message_generation_status_idx').on(table.generationStatus, table.createdAt),
    index('ai_message_retention_idx').on(table.retentionExpiresAt, table.anonymizedAt),
  ],
);

export const aiUsageEvent = sqliteTable(
  'ai_usage_event',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    storeId: text('store_id').references(() => store.id, {
      onDelete: 'set null',
    }),
    conversationId: text('conversation_id').references(() => aiConversation.id, {
      onDelete: 'set null',
    }),
    messageId: text('message_id').references(() => aiMessage.id, { onDelete: 'set null' }),
    provider: text('provider'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    generationStatus: text('generation_status').notNull(),
    errorCode: text('error_code'),
    errorSummary: text('error_summary'),
    aiGatewayLogId: text('ai_gateway_log_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('ai_usage_event_subject_created_idx').on(
      table.subjectType,
      table.subjectId,
      table.createdAt,
    ),
    index('ai_usage_event_actor_created_idx').on(table.actorUserId, table.createdAt),
    index('ai_usage_event_conversation_idx').on(table.conversationId, table.messageId),
    index('ai_usage_event_status_idx').on(table.generationStatus, table.createdAt),
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
  storeMembers: many(storeMember),
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
  aiUsageEvents: many(aiUsageEvent),
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
  store: one(store, {
    fields: [aiKnowledgeDocument.storeId],
    references: [store.id],
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
  store: one(store, {
    fields: [aiKnowledgeChunk.storeId],
    references: [store.id],
  }),
}));

export const aiConversationRelations = relations(aiConversation, ({ one, many }) => ({
  actor: one(user, {
    fields: [aiConversation.actorUserId],
    references: [user.id],
  }),
  store: one(store, {
    fields: [aiConversation.storeId],
    references: [store.id],
  }),
  messages: many(aiMessage),
  usageEvents: many(aiUsageEvent),
}));

export const aiMessageRelations = relations(aiMessage, ({ one, many }) => ({
  conversation: one(aiConversation, {
    fields: [aiMessage.conversationId],
    references: [aiConversation.id],
  }),
  feedback: many(aiFeedback),
  usageEvents: many(aiUsageEvent),
}));

export const aiUsageEventRelations = relations(aiUsageEvent, ({ one }) => ({
  actor: one(user, {
    fields: [aiUsageEvent.actorUserId],
    references: [user.id],
  }),
  store: one(store, {
    fields: [aiUsageEvent.storeId],
    references: [store.id],
  }),
  conversation: one(aiConversation, {
    fields: [aiUsageEvent.conversationId],
    references: [aiConversation.id],
  }),
  message: one(aiMessage, {
    fields: [aiUsageEvent.messageId],
    references: [aiMessage.id],
  }),
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
  stores: many(store),
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
}));

export const storeRelations = relations(store, ({ one, many }) => ({
  organization: one(organization, {
    fields: [store.organizationId],
    references: [organization.id],
  }),
  members: many(storeMember),
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
  aiUsageEvents: many(aiUsageEvent),
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

export const storeMemberRelations = relations(storeMember, ({ one }) => ({
  store: one(store, {
    fields: [storeMember.storeId],
    references: [store.id],
  }),
  user: one(user, {
    fields: [storeMember.userId],
    references: [user.id],
  }),
}));

export const participantRelations = relations(participant, ({ one, many }) => ({
  organization: one(organization, {
    fields: [participant.organizationId],
    references: [organization.id],
  }),
  store: one(store, {
    fields: [participant.storeId],
    references: [store.id],
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
  store: one(store, {
    fields: [service.storeId],
    references: [store.id],
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
  store: one(store, {
    fields: [recurringSchedule.storeId],
    references: [store.id],
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
    store: one(store, {
      fields: [recurringScheduleException.storeId],
      references: [store.id],
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
  store: one(store, {
    fields: [slot.storeId],
    references: [store.id],
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
  store: one(store, {
    fields: [booking.storeId],
    references: [store.id],
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
  changeLogs: many(bookingChangeLog),
}));

export const bookingChangeLogRelations = relations(bookingChangeLog, ({ one }) => ({
  booking: one(booking, {
    fields: [bookingChangeLog.bookingId],
    references: [booking.id],
  }),
  organization: one(organization, {
    fields: [bookingChangeLog.organizationId],
    references: [organization.id],
  }),
  store: one(store, {
    fields: [bookingChangeLog.storeId],
    references: [store.id],
  }),
  changedByUser: one(user, {
    fields: [bookingChangeLog.changedByUserId],
    references: [user.id],
  }),
}));

export const ticketTypeRelations = relations(ticketType, ({ one, many }) => ({
  organization: one(organization, {
    fields: [ticketType.organizationId],
    references: [organization.id],
  }),
  store: one(store, {
    fields: [ticketType.storeId],
    references: [store.id],
  }),
  ticketPacks: many(ticketPack),
  ticketPurchases: many(ticketPurchase),
}));

export const ticketPackRelations = relations(ticketPack, ({ one, many }) => ({
  organization: one(organization, {
    fields: [ticketPack.organizationId],
    references: [organization.id],
  }),
  store: one(store, {
    fields: [ticketPack.storeId],
    references: [store.id],
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
  store: one(store, {
    fields: [ticketPurchase.storeId],
    references: [store.id],
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
  store: one(store, {
    fields: [ticketLedger.storeId],
    references: [store.id],
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
  store: one(store, {
    fields: [invitation.storeId],
    references: [store.id],
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
  acceptedStoreMember: one(storeMember, {
    fields: [invitation.acceptedStoreMemberId],
    references: [storeMember.id],
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
  store: one(store, {
    fields: [invitationAuditLog.storeId],
    references: [store.id],
  }),
  actor: one(user, {
    fields: [invitationAuditLog.actorUserId],
    references: [user.id],
  }),
}));
