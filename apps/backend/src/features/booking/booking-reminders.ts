import { and, eq, gt, lte } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import { DEFAULT_TIMEZONE, BOOKING_STATUS } from '../../domain/booking/constants.js';
import * as dbSchema from '../../infra/db/schema.js';
import { sendBookingNotificationEmail } from '../../infra/email/resend.js';
import { assertSupportedTimezone, formatDateTimeLabel } from '../../shared/date.js';

const DEFAULT_REMINDER_MINUTES_BEFORE = 24 * 60;

const normalizeEmail = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().toLowerCase() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const createReminderLog = async ({
  database,
  organizationId,
  storeId,
  bookingId,
  recipientEmail,
  scheduledFor,
  dedupeKey,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
  bookingId: string;
  recipientEmail: string;
  scheduledFor: Date;
  dedupeKey: string;
}) => {
  const existing = await database
    .select({ id: dbSchema.reminderLog.id })
    .from(dbSchema.reminderLog)
    .where(eq(dbSchema.reminderLog.dedupeKey, dedupeKey))
    .limit(1);
  if (existing[0]) {
    return null;
  }

  const id = crypto.randomUUID();
  await database.insert(dbSchema.reminderLog).values({
    id,
    organizationId,
    storeId,
    bookingId,
    reminderPolicyId: null,
    channel: 'email',
    recipientEmail,
    status: 'pending',
    dedupeKey,
    scheduledFor,
  });
  return id;
};

const updateReminderLog = async ({
  database,
  id,
  status,
  errorMessage,
}: {
  database: AuthRuntimeDatabase;
  id: string;
  status: 'sent' | 'failed' | 'skipped';
  errorMessage?: string | null;
}) => {
  await database
    .update(dbSchema.reminderLog)
    .set({
      status,
      errorMessage: errorMessage ?? null,
      sentAt: status === 'sent' ? new Date() : null,
    })
    .where(eq(dbSchema.reminderLog.id, id));
};

/**
 * 予約開始 24 時間前を過ぎた confirmed 予約へ、一度だけ reminder を送ります。
 */
export const sendDueBookingReminders = async ({
  database,
  env,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  now?: Date;
}) => {
  const dueUntil = new Date(now.getTime() + DEFAULT_REMINDER_MINUTES_BEFORE * 60 * 1000);
  const rows = await database
    .select({
      bookingId: dbSchema.booking.id,
      organizationId: dbSchema.booking.organizationId,
      storeId: dbSchema.booking.storeId,
      organizationName: dbSchema.organization.name,
      participantEmail: dbSchema.participant.email,
      participantName: dbSchema.participant.name,
      customerEmail: dbSchema.booking.customerEmail,
      customerName: dbSchema.booking.customerName,
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
    .where(
      and(
        eq(dbSchema.booking.status, BOOKING_STATUS.CONFIRMED),
        gt(dbSchema.slot.startAt, now),
        lte(dbSchema.slot.startAt, dueUntil),
      ),
    )
    .limit(200);

  for (const row of rows) {
    const recipientEmail = normalizeEmail(row.customerEmail ?? row.participantEmail);
    if (!recipientEmail) {
      continue;
    }

    const dedupeKey = `booking-reminder:${row.bookingId}:${DEFAULT_REMINDER_MINUTES_BEFORE}:${recipientEmail}`;
    const logId = await createReminderLog({
      database,
      organizationId: row.organizationId,
      storeId: row.storeId,
      bookingId: row.bookingId,
      recipientEmail,
      scheduledFor: now,
      dedupeKey,
    });
    if (!logId) {
      continue;
    }

    try {
      const timezone =
        assertSupportedTimezone(row.serviceTimezone ?? undefined) ?? DEFAULT_TIMEZONE;
      await sendBookingNotificationEmail({
        env,
        inviteeEmail: recipientEmail,
        organizationName: row.organizationName,
        participantName: row.customerName ?? row.participantName ?? '予約者',
        serviceName: row.serviceName,
        participantsCount: row.participantsCount,
        slotStartLabel: formatDateTimeLabel(row.slotStartAt, timezone),
        slotEndLabel: formatDateTimeLabel(row.slotEndAt, timezone),
        event: 'booking_reminder',
        bookingId: row.bookingId,
      });
      await updateReminderLog({ database, id: logId, status: 'sent' });
    } catch (error) {
      await updateReminderLog({
        database,
        id: logId,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
