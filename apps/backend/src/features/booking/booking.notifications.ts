import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import { BOOKING_STATUS, DEFAULT_TIMEZONE } from '../../domain/booking/constants.js';
import * as dbSchema from '../../infra/db/schema.js';
import {
  sendBookingNotificationEmail,
  type BookingNotificationEvent,
  type SendBookingNotificationInput,
} from '../../infra/email/resend.js';
import { assertSupportedTimezone, formatDateTimeLabel } from '../../shared/date.js';

const DEFAULT_REMINDER_MINUTES_BEFORE = 24 * 60;
const SUPPORTED_REMINDER_MINUTES_BEFORE = [DEFAULT_REMINDER_MINUTES_BEFORE, 3 * 60] as const;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCK_MS = 5 * 60 * 1000;

const bookingNotificationSubjectMap: Record<BookingNotificationEvent, string> = {
  booking_confirmed: '【予約通知】予約が確定しました',
  booking_application_received: '【予約通知】予約申請を受け付けました',
  booking_approved: '【予約通知】予約が承認されました',
  booking_rejected: '【予約通知】予約が却下されました',
  booking_cancelled_by_participant: '【予約通知】予約をキャンセルしました',
  booking_cancelled_by_staff: '【予約通知】運営により予約がキャンセルされました',
  booking_rescheduled: '【予約通知】予約日時が変更されました',
  booking_no_show: '【予約通知】予約がNo-showとして記録されました',
  booking_reminder: '【予約通知】予約リマインド',
};

const notificationEventTypeByTemplate: Record<BookingNotificationEvent, string> = {
  booking_confirmed: 'booking.confirmed',
  booking_application_received: 'booking.application_received',
  booking_approved: 'booking.confirmed',
  booking_rejected: 'booking.rejected',
  booking_cancelled_by_participant: 'booking.cancelled_by_participant',
  booking_cancelled_by_staff: 'booking.cancelled_by_staff',
  booking_rescheduled: 'booking.rescheduled',
  booking_no_show: 'booking.no_show',
  booking_reminder: 'booking.reminder',
};

type NotificationRecipientType = 'customer' | 'store';
type NotificationOutboxStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'retry'
  | 'cancelled'
  | 'dead'
  | 'skipped';

type BookingNotificationPayload = Omit<SendBookingNotificationInput, 'env' | 'inviteeEmail'> & {
  reminderMinutesBefore?: number;
  slotStartAt?: string;
  recipientRole?: string | null;
};

type BookingNotificationContext = {
  bookingId: string;
  organizationId: string;
  storeId: string;
  participantId: string | null;
  bookingStatus: string;
  organizationName: string;
  participantEmail: string | null;
  participantName: string | null;
  customerEmail: string | null;
  customerName: string | null;
  serviceId: string;
  serviceName: string;
  serviceTimezone: string | null;
  participantsCount: number;
  slotStartAt: Date;
  slotEndAt: Date;
};

const isBookingNotificationEvent = (value: string): value is BookingNotificationEvent =>
  value in notificationEventTypeByTemplate;

const normalizeEmail = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().toLowerCase() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const parseAdditionalEmails = (value: string | null): string[] => {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .map((entry) => (typeof entry === 'string' ? normalizeEmail(entry) : null))
          .filter((entry): entry is string => entry !== null)
      : [];
  } catch {
    return [];
  }
};

const getBookingNotificationContext = async ({
  database,
  bookingId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
}): Promise<BookingNotificationContext | null> => {
  const rows = await database
    .select({
      bookingId: dbSchema.booking.id,
      organizationId: dbSchema.booking.organizationId,
      storeId: dbSchema.booking.storeId,
      participantId: dbSchema.booking.participantId,
      bookingStatus: dbSchema.booking.status,
      organizationName: dbSchema.organization.name,
      participantEmail: dbSchema.participant.email,
      participantName: dbSchema.participant.name,
      customerEmail: dbSchema.booking.customerEmail,
      customerName: dbSchema.booking.customerName,
      serviceId: dbSchema.booking.serviceId,
      serviceName: dbSchema.service.name,
      serviceTimezone: dbSchema.service.timezone,
      participantsCount: dbSchema.booking.participantsCount,
      slotStartAt: dbSchema.slot.startAt,
      slotEndAt: dbSchema.slot.endAt,
    })
    .from(dbSchema.booking)
    .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.booking.organizationId))
    .leftJoin(dbSchema.participant, eq(dbSchema.participant.id, dbSchema.booking.participantId))
    .innerJoin(dbSchema.service, eq(dbSchema.service.id, dbSchema.booking.serviceId))
    .innerJoin(dbSchema.slot, eq(dbSchema.slot.id, dbSchema.booking.slotId))
    .where(eq(dbSchema.booking.id, bookingId))
    .limit(1);

  return rows[0] ?? null;
};

const toBookingNotificationPayload = ({
  context,
  event,
  reason,
  actionUrl,
  actionLabel,
  reminderMinutesBefore,
  recipientRole,
}: {
  context: BookingNotificationContext;
  event: BookingNotificationEvent;
  reason?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  reminderMinutesBefore?: number;
  recipientRole?: string | null;
}): BookingNotificationPayload => {
  const timezone =
    assertSupportedTimezone(context.serviceTimezone ?? undefined) ?? DEFAULT_TIMEZONE;
  return {
    organizationName: context.organizationName,
    participantName: context.customerName ?? context.participantName ?? '予約者',
    serviceName: context.serviceName,
    participantsCount: context.participantsCount,
    slotStartLabel: formatDateTimeLabel(context.slotStartAt, timezone),
    slotEndLabel: formatDateTimeLabel(context.slotEndAt, timezone),
    event,
    reason: reason ?? null,
    bookingId: context.bookingId,
    actionUrl: actionUrl ?? null,
    actionLabel: actionLabel ?? null,
    reminderMinutesBefore,
    slotStartAt: context.slotStartAt.toISOString(),
    recipientRole: recipientRole ?? null,
  };
};

const createIdempotencyKey = ({
  eventType,
  bookingId,
  recipientType,
  recipientEmail,
  businessVersion,
}: {
  eventType: string;
  bookingId: string;
  recipientType: NotificationRecipientType;
  recipientEmail: string;
  businessVersion: string;
}) => `${eventType}:${bookingId}:${recipientType}:${recipientEmail}:${businessVersion}`;

const insertNotificationOutbox = async ({
  database,
  context,
  event,
  recipientType,
  recipientEmail,
  recipientName,
  recipientRole,
  reason,
  actionUrl,
  actionLabel,
  scheduledFor,
  businessVersion,
  reminderMinutesBefore,
}: {
  database: AuthRuntimeDatabase;
  context: BookingNotificationContext;
  event: BookingNotificationEvent;
  recipientType: NotificationRecipientType;
  recipientEmail: string;
  recipientName?: string | null;
  recipientRole?: string | null;
  reason?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  scheduledFor?: Date;
  businessVersion: string;
  reminderMinutesBefore?: number;
}) => {
  const eventType = notificationEventTypeByTemplate[event];
  const dueAt = scheduledFor ?? new Date();
  const idempotencyKey = createIdempotencyKey({
    eventType,
    bookingId: context.bookingId,
    recipientType,
    recipientEmail,
    businessVersion,
  });
  const payload = toBookingNotificationPayload({
    context,
    event,
    reason,
    actionUrl,
    actionLabel,
    reminderMinutesBefore,
    recipientRole,
  });

  await database
    .insert(dbSchema.notificationOutbox)
    .values({
      id: crypto.randomUUID(),
      organizationId: context.organizationId,
      storeId: context.storeId,
      bookingId: context.bookingId,
      participantId: context.participantId,
      eventType,
      templateKey: event,
      channel: 'email',
      recipientType,
      recipientEmail,
      recipientName: recipientName ?? null,
      subjectSnapshot: bookingNotificationSubjectMap[event],
      payloadJson: JSON.stringify(payload),
      status: 'pending',
      scheduledFor: dueAt,
      nextAttemptAt: dueAt,
      attemptCount: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      idempotencyKey,
    })
    .onConflictDoNothing();
};

const getOperationalRecipients = async ({
  database,
  organizationId,
  storeId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
}) => {
  const settingRows = await database
    .select()
    .from(dbSchema.publicSiteNotificationSetting)
    .where(
      and(
        eq(dbSchema.publicSiteNotificationSetting.organizationId, organizationId),
        eq(dbSchema.publicSiteNotificationSetting.storeId, storeId),
      ),
    )
    .limit(1);
  const setting = settingRows[0] ?? null;

  const recipients = new Map<string, { email: string; role: string }>();
  const addRecipient = (emailValue: string | null | undefined, role: string) => {
    const email = normalizeEmail(emailValue);
    if (email && !recipients.has(email)) {
      recipients.set(email, { email, role });
    }
  };

  for (const email of parseAdditionalEmails(setting?.additionalEmailsJson ?? null)) {
    addRecipient(email, 'additional');
  }

  const memberRoles: string[] = [];
  const storeRoles: string[] = [];
  if (!setting || setting.notifyOwner) {
    memberRoles.push('owner');
  }
  if (!setting || setting.notifyAdmins) {
    memberRoles.push('admin');
  }
  if (!setting || setting.notifyStoreManagers) {
    storeRoles.push('manager');
  }
  if (setting?.notifyStaff) {
    storeRoles.push('staff');
  }

  if (memberRoles.length > 0) {
    const rows = await database
      .select({
        email: dbSchema.user.email,
        role: dbSchema.member.role,
      })
      .from(dbSchema.member)
      .innerJoin(dbSchema.user, eq(dbSchema.user.id, dbSchema.member.userId))
      .where(
        and(
          eq(dbSchema.member.organizationId, organizationId),
          inArray(dbSchema.member.role, Array.from(new Set(memberRoles))),
        ),
      );
    for (const row of rows) {
      addRecipient(row.email, row.role);
    }
  }

  if (storeRoles.length > 0) {
    const rows = await database
      .select({
        email: dbSchema.user.email,
        role: dbSchema.storeMember.role,
      })
      .from(dbSchema.storeMember)
      .innerJoin(dbSchema.user, eq(dbSchema.user.id, dbSchema.storeMember.userId))
      .where(
        and(
          eq(dbSchema.storeMember.storeId, storeId),
          inArray(dbSchema.storeMember.role, Array.from(new Set(storeRoles))),
        ),
      );
    for (const row of rows) {
      addRecipient(row.email, row.role);
    }
  }

  return Array.from(recipients.values());
};

const resolveReminderMinutesForBooking = async ({
  database,
  organizationId,
  storeId,
  serviceId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
  serviceId: string;
}) => {
  const rows: Array<{ serviceId: string | null; enabled: boolean; minutesBefore: number }> =
    await database
      .select({
        serviceId: dbSchema.reminderPolicy.serviceId,
        enabled: dbSchema.reminderPolicy.enabled,
        minutesBefore: dbSchema.reminderPolicy.minutesBefore,
      })
      .from(dbSchema.reminderPolicy)
      .where(
        and(
          eq(dbSchema.reminderPolicy.organizationId, organizationId),
          eq(dbSchema.reminderPolicy.storeId, storeId),
          or(
            isNull(dbSchema.reminderPolicy.serviceId),
            eq(dbSchema.reminderPolicy.serviceId, serviceId),
          ),
        ),
      );

  const serviceRows = rows.filter((row) => row.serviceId === serviceId);
  const storeRows = rows.filter((row) => row.serviceId === null);
  const candidateRows = serviceRows.length > 0 ? serviceRows : storeRows;
  if (candidateRows.length === 0) {
    return [DEFAULT_REMINDER_MINUTES_BEFORE];
  }

  const enabledMinutes = new Set(
    candidateRows
      .filter((row) => row.enabled)
      .map((row) => row.minutesBefore)
      .filter((minutes) => minutes > 0),
  );
  return SUPPORTED_REMINDER_MINUTES_BEFORE.filter((minutes) => enabledMinutes.has(minutes));
};

export const enqueueBookingCustomerNotificationOutbox = async ({
  database,
  bookingId,
  event,
  reason,
  actionUrl,
  actionLabel,
  dedupeKeyExtra,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  event: BookingNotificationEvent;
  reason?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  dedupeKeyExtra?: string | null;
}) => {
  const context = await getBookingNotificationContext({ database, bookingId });
  if (!context) {
    return;
  }

  const recipientEmail = normalizeEmail(context.customerEmail ?? context.participantEmail);
  if (!recipientEmail) {
    return;
  }

  await insertNotificationOutbox({
    database,
    context,
    event,
    recipientType: 'customer',
    recipientEmail,
    recipientName: context.customerName ?? context.participantName,
    reason,
    actionUrl,
    actionLabel,
    businessVersion: dedupeKeyExtra ?? 'v1',
  });
};

export const enqueueBookingOperationalNotificationOutbox = async ({
  database,
  bookingId,
  event,
  reason,
  dedupeKeyExtra,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  event: BookingNotificationEvent;
  reason?: string | null;
  dedupeKeyExtra?: string | null;
}) => {
  const context = await getBookingNotificationContext({ database, bookingId });
  if (!context) {
    return;
  }

  const recipients = await getOperationalRecipients({
    database,
    organizationId: context.organizationId,
    storeId: context.storeId,
  });

  await Promise.all(
    recipients.map((recipient) =>
      insertNotificationOutbox({
        database,
        context,
        event,
        recipientType: 'store',
        recipientEmail: recipient.email,
        recipientRole: recipient.role,
        reason,
        businessVersion: dedupeKeyExtra ?? 'v1',
      }),
    ),
  );
};

export const enqueueBookingRemindersForBooking = async ({
  database,
  bookingId,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  now?: Date;
}) => {
  const context = await getBookingNotificationContext({ database, bookingId });
  if (!context || context.bookingStatus !== BOOKING_STATUS.CONFIRMED) {
    return;
  }

  const recipientEmail = normalizeEmail(context.customerEmail ?? context.participantEmail);
  if (!recipientEmail || context.slotStartAt.getTime() <= now.getTime()) {
    return;
  }

  const reminderMinutes = await resolveReminderMinutesForBooking({
    database,
    organizationId: context.organizationId,
    storeId: context.storeId,
    serviceId: context.serviceId,
  });

  await Promise.all(
    reminderMinutes.map(async (minutesBefore) => {
      const scheduledFor = new Date(context.slotStartAt.getTime() - minutesBefore * 60 * 1000);
      if (scheduledFor.getTime() <= now.getTime()) {
        return;
      }

      await insertNotificationOutbox({
        database,
        context,
        event: 'booking_reminder',
        recipientType: 'customer',
        recipientEmail,
        recipientName: context.customerName ?? context.participantName,
        scheduledFor,
        businessVersion: `${minutesBefore}:slot_start_${context.slotStartAt.getTime()}`,
        reminderMinutesBefore: minutesBefore,
      });
    }),
  );
};

const appendNotificationLog = async ({
  database,
  outbox,
  status,
  attemptNumber,
  errorMessage,
  provider,
  providerMessageId,
  responseJson,
}: {
  database: AuthRuntimeDatabase;
  outbox: typeof dbSchema.notificationOutbox.$inferSelect;
  status: 'attempt_started' | 'sent' | 'failed' | 'skipped' | 'cancelled' | 'manual_marked_dead';
  attemptNumber?: number | null;
  errorMessage?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  responseJson?: string | null;
}) => {
  await database.insert(dbSchema.notificationLog).values({
    id: crypto.randomUUID(),
    outboxId: outbox.id,
    organizationId: outbox.organizationId,
    storeId: outbox.storeId,
    bookingId: outbox.bookingId,
    eventType: outbox.eventType,
    templateKey: outbox.templateKey,
    channel: outbox.channel,
    recipientType: outbox.recipientType,
    recipientEmail: outbox.recipientEmail,
    status,
    attemptNumber: attemptNumber ?? null,
    provider: provider ?? null,
    providerMessageId: providerMessageId ?? null,
    dedupeKey: `outbox-log:${outbox.id}:${status}:${attemptNumber ?? 0}:${crypto.randomUUID()}`,
    errorMessage: errorMessage ?? null,
    responseJson: responseJson ?? null,
  });
};

export const cancelPendingBookingReminderOutboxes = async ({
  database,
  bookingId,
  includeProcessing = false,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  includeProcessing?: boolean;
  now?: Date;
}) => {
  const statuses = includeProcessing ? ['pending', 'retry', 'processing'] : ['pending', 'retry'];
  const cancelledRows = await database
    .update(dbSchema.notificationOutbox)
    .set({
      status: 'cancelled',
      cancelledAt: now,
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(dbSchema.notificationOutbox.bookingId, bookingId),
        eq(dbSchema.notificationOutbox.eventType, 'booking.reminder'),
        inArray(dbSchema.notificationOutbox.status, statuses),
      ),
    )
    .returning();

  for (const outbox of cancelledRows) {
    await appendNotificationLog({
      database,
      outbox,
      status: 'cancelled',
      attemptNumber: outbox.attemptCount,
    });
  }
};

export const regenerateFutureBookingReminderOutboxes = async ({
  database,
  organizationId,
  storeId,
  serviceId,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
  serviceId?: string | null;
  now?: Date;
}) => {
  const rows = await database
    .select({
      bookingId: dbSchema.booking.id,
    })
    .from(dbSchema.booking)
    .innerJoin(dbSchema.slot, eq(dbSchema.slot.id, dbSchema.booking.slotId))
    .where(
      and(
        eq(dbSchema.booking.organizationId, organizationId),
        eq(dbSchema.booking.storeId, storeId),
        eq(dbSchema.booking.status, BOOKING_STATUS.CONFIRMED),
        gt(dbSchema.slot.startAt, now),
        serviceId ? eq(dbSchema.booking.serviceId, serviceId) : undefined,
      ),
    );

  for (const row of rows) {
    await cancelPendingBookingReminderOutboxes({
      database,
      bookingId: row.bookingId,
      now,
    });
    await enqueueBookingRemindersForBooking({
      database,
      bookingId: row.bookingId,
      now,
    });
  }
};

const shouldSendReminderOutbox = async ({
  database,
  outbox,
  payload,
  now,
}: {
  database: AuthRuntimeDatabase;
  outbox: typeof dbSchema.notificationOutbox.$inferSelect;
  payload: BookingNotificationPayload;
  now: Date;
}) => {
  if (outbox.eventType !== 'booking.reminder') {
    return true;
  }
  if (!outbox.bookingId || typeof payload.reminderMinutesBefore !== 'number') {
    return false;
  }

  const context = await getBookingNotificationContext({ database, bookingId: outbox.bookingId });
  if (!context || context.bookingStatus !== BOOKING_STATUS.CONFIRMED) {
    return false;
  }
  if (context.slotStartAt.getTime() <= now.getTime()) {
    return false;
  }
  if (
    payload.slotStartAt &&
    new Date(payload.slotStartAt).getTime() !== context.slotStartAt.getTime()
  ) {
    return false;
  }

  const recipientEmail = normalizeEmail(context.customerEmail ?? context.participantEmail);
  if (recipientEmail !== normalizeEmail(outbox.recipientEmail)) {
    return false;
  }

  const reminderMinutes = await resolveReminderMinutesForBooking({
    database,
    organizationId: context.organizationId,
    storeId: context.storeId,
    serviceId: context.serviceId,
  });
  return reminderMinutes.includes(payload.reminderMinutesBefore);
};

const parseNotificationPayload = (
  outbox: typeof dbSchema.notificationOutbox.$inferSelect,
): BookingNotificationPayload | null => {
  if (!isBookingNotificationEvent(outbox.templateKey)) {
    return null;
  }

  try {
    const parsed = JSON.parse(outbox.payloadJson) as Partial<BookingNotificationPayload>;
    if (
      typeof parsed.organizationName !== 'string' ||
      typeof parsed.participantName !== 'string' ||
      typeof parsed.serviceName !== 'string' ||
      typeof parsed.participantsCount !== 'number' ||
      typeof parsed.slotStartLabel !== 'string' ||
      typeof parsed.slotEndLabel !== 'string' ||
      parsed.event !== outbox.templateKey ||
      typeof parsed.bookingId !== 'string'
    ) {
      return null;
    }
    return parsed as BookingNotificationPayload;
  } catch {
    return null;
  }
};

const markOutboxTerminal = async ({
  database,
  outboxId,
  status,
  now,
  providerMessageId,
  errorMessage,
}: {
  database: AuthRuntimeDatabase;
  outboxId: string;
  status: Extract<NotificationOutboxStatus, 'sent' | 'skipped' | 'dead'>;
  now: Date;
  providerMessageId?: string | null;
  errorMessage?: string | null;
}) => {
  await database
    .update(dbSchema.notificationOutbox)
    .set({
      status,
      provider: status === 'sent' ? 'resend' : null,
      providerMessageId: providerMessageId ?? null,
      lastError: errorMessage ?? null,
      sentAt: status === 'sent' ? now : null,
      deadAt: status === 'dead' ? now : null,
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(dbSchema.notificationOutbox.id, outboxId));
};

const markOutboxRetry = async ({
  database,
  outboxId,
  now,
  attemptNumber,
  errorMessage,
}: {
  database: AuthRuntimeDatabase;
  outboxId: string;
  now: Date;
  attemptNumber: number;
  errorMessage: string;
}) => {
  const backoffMinutes = Math.min(60, 2 ** Math.max(0, attemptNumber - 1));
  await database
    .update(dbSchema.notificationOutbox)
    .set({
      status: 'retry',
      nextAttemptAt: new Date(now.getTime() + backoffMinutes * 60 * 1000),
      lastError: errorMessage,
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(dbSchema.notificationOutbox.id, outboxId));
};

const processClaimedOutbox = async ({
  database,
  env,
  outbox,
  now,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  outbox: typeof dbSchema.notificationOutbox.$inferSelect;
  now: Date;
}) => {
  const attemptNumber = outbox.attemptCount;
  await appendNotificationLog({
    database,
    outbox,
    status: 'attempt_started',
    attemptNumber,
  });

  const payload = parseNotificationPayload(outbox);
  if (!payload) {
    const message = 'Notification payload is invalid.';
    await appendNotificationLog({
      database,
      outbox,
      status: 'failed',
      attemptNumber,
      errorMessage: message,
    });
    await markOutboxTerminal({
      database,
      outboxId: outbox.id,
      status: 'dead',
      now,
      errorMessage: message,
    });
    return;
  }

  const shouldSend = await shouldSendReminderOutbox({ database, outbox, payload, now });
  if (!shouldSend) {
    await appendNotificationLog({
      database,
      outbox,
      status: 'skipped',
      attemptNumber,
    });
    await markOutboxTerminal({ database, outboxId: outbox.id, status: 'skipped', now });
    return;
  }

  try {
    const providerMessageId = await sendBookingNotificationEmail({
      env,
      inviteeEmail: outbox.recipientEmail,
      organizationName: payload.organizationName,
      participantName: payload.participantName,
      serviceName: payload.serviceName,
      participantsCount: payload.participantsCount,
      slotStartLabel: payload.slotStartLabel,
      slotEndLabel: payload.slotEndLabel,
      event: payload.event,
      reason: payload.reason,
      bookingId: payload.bookingId,
      actionUrl: payload.actionUrl,
      actionLabel: payload.actionLabel,
    });

    await appendNotificationLog({
      database,
      outbox,
      status: 'sent',
      attemptNumber,
      provider: 'resend',
      providerMessageId,
      responseJson: JSON.stringify({ providerMessageId }),
    });
    await markOutboxTerminal({
      database,
      outboxId: outbox.id,
      status: 'sent',
      now,
      providerMessageId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendNotificationLog({
      database,
      outbox,
      status: 'failed',
      attemptNumber,
      provider: 'resend',
      errorMessage: message,
    });

    if (attemptNumber >= outbox.maxAttempts) {
      await markOutboxTerminal({
        database,
        outboxId: outbox.id,
        status: 'dead',
        now,
        errorMessage: message,
      });
      return;
    }

    await markOutboxRetry({
      database,
      outboxId: outbox.id,
      now,
      attemptNumber,
      errorMessage: message,
    });
  }
};

export const processDueNotificationOutbox = async ({
  database,
  env,
  now = new Date(),
  limit = 50,
  lockOwner = crypto.randomUUID(),
  eventTypes,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  now?: Date;
  limit?: number;
  lockOwner?: string;
  eventTypes?: string[];
}) => {
  const candidates = await database
    .select()
    .from(dbSchema.notificationOutbox)
    .where(
      and(
        eq(dbSchema.notificationOutbox.channel, 'email'),
        lte(dbSchema.notificationOutbox.scheduledFor, now),
        eventTypes && eventTypes.length > 0
          ? inArray(dbSchema.notificationOutbox.eventType, eventTypes)
          : undefined,
        or(
          and(
            inArray(dbSchema.notificationOutbox.status, ['pending', 'retry']),
            lte(dbSchema.notificationOutbox.nextAttemptAt, now),
          ),
          and(
            eq(dbSchema.notificationOutbox.status, 'processing'),
            lte(dbSchema.notificationOutbox.lockExpiresAt, now),
          ),
        ),
      ),
    )
    .orderBy(
      asc(dbSchema.notificationOutbox.nextAttemptAt),
      asc(dbSchema.notificationOutbox.createdAt),
    )
    .limit(limit);

  for (const candidate of candidates) {
    const claimedRows = await database
      .update(dbSchema.notificationOutbox)
      .set({
        status: 'processing',
        attemptCount: sql`${dbSchema.notificationOutbox.attemptCount} + 1`,
        lockedAt: now,
        lockedBy: lockOwner,
        lockExpiresAt: new Date(now.getTime() + DEFAULT_LOCK_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(dbSchema.notificationOutbox.id, candidate.id),
          or(
            and(
              inArray(dbSchema.notificationOutbox.status, ['pending', 'retry']),
              lte(dbSchema.notificationOutbox.nextAttemptAt, now),
            ),
            and(
              eq(dbSchema.notificationOutbox.status, 'processing'),
              lte(dbSchema.notificationOutbox.lockExpiresAt, now),
            ),
          ),
        ),
      )
      .returning();

    const claimed = claimedRows[0];
    if (!claimed) {
      continue;
    }

    await processClaimedOutbox({ database, env, outbox: claimed, now });
  }
};

export const notifyBookingEmailBestEffort = async ({
  database,
  bookingId,
  event,
  reason,
  actionUrl,
  actionLabel,
  dedupeKeyExtra,
}: {
  database: AuthRuntimeDatabase;
  env?: AuthRuntimeEnv;
  bookingId: string;
  event: BookingNotificationEvent;
  reason?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  dedupeKeyExtra?: string | null;
}) => {
  try {
    await enqueueBookingCustomerNotificationOutbox({
      database,
      bookingId,
      event,
      reason,
      actionUrl,
      actionLabel,
      dedupeKeyExtra,
    });
  } catch (error) {
    console.warn(
      `[booking-email] Failed to enqueue booking notification. bookingId=${bookingId}`,
      error,
    );
  }
};

export const notifyBookingOperationalEmailBestEffort = async ({
  database,
  bookingId,
  event,
  reason,
  dedupeKeyExtra,
}: {
  database: AuthRuntimeDatabase;
  env?: AuthRuntimeEnv;
  bookingId: string;
  event: BookingNotificationEvent;
  reason?: string | null;
  dedupeKeyExtra?: string | null;
}) => {
  try {
    await enqueueBookingOperationalNotificationOutbox({
      database,
      bookingId,
      event,
      reason,
      dedupeKeyExtra,
    });
  } catch (error) {
    console.warn(
      `[booking-email] Failed to enqueue booking operational notification. bookingId=${bookingId}`,
      error,
    );
  }
};
