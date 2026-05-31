import { and, eq, inArray } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import { DEFAULT_TIMEZONE } from '../../domain/booking/constants.js';
import * as dbSchema from '../../infra/db/schema.js';
import {
  sendBookingNotificationEmail,
  type BookingNotificationEvent,
} from '../../infra/email/resend.js';
import { assertSupportedTimezone, formatDateTimeLabel } from '../../shared/date.js';

const getBookingNotificationContext = async ({
  database,
  bookingId,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
}) => {
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
    .where(eq(dbSchema.booking.id, bookingId))
    .limit(1);

  return rows[0] ?? null;
};

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

const createNotificationLog = async ({
  database,
  organizationId,
  storeId,
  bookingId,
  eventType,
  recipientEmail,
  dedupeKey,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
  bookingId: string;
  eventType: string;
  recipientEmail: string;
  dedupeKey: string;
}) => {
  const existing = await database
    .select({
      id: dbSchema.notificationLog.id,
      status: dbSchema.notificationLog.status,
    })
    .from(dbSchema.notificationLog)
    .where(eq(dbSchema.notificationLog.dedupeKey, dedupeKey))
    .limit(1);
  if (existing[0]) {
    return null;
  }

  const id = crypto.randomUUID();
  await database.insert(dbSchema.notificationLog).values({
    id,
    organizationId,
    storeId,
    bookingId,
    eventType,
    channel: 'email',
    recipientEmail,
    status: 'pending',
    dedupeKey,
  });
  return id;
};

const updateNotificationLog = async ({
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
    .update(dbSchema.notificationLog)
    .set({
      status,
      errorMessage: errorMessage ?? null,
      updatedAt: new Date(),
    })
    .where(eq(dbSchema.notificationLog.id, id));
};

const getOperationalRecipientEmails = async ({
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

  const memberRoles: string[] = [];
  const storeRoles: string[] = [];
  if (!setting || setting.notifyOwner) {
    memberRoles.push('owner');
  }
  if (!setting || setting.notifyAdmins) {
    memberRoles.push('admin');
  }
  if (setting?.notifyStoreManagers) {
    storeRoles.push('manager');
  }
  if (setting?.notifyStaff) {
    storeRoles.push('staff');
  }

  const emails = new Set<string>(parseAdditionalEmails(setting?.additionalEmailsJson ?? null));

  if (memberRoles.length > 0) {
    const rows = await database
      .select({
        email: dbSchema.user.email,
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
      const email = normalizeEmail(row.email);
      if (email) {
        emails.add(email);
      }
    }
  }

  if (storeRoles.length > 0) {
    const rows = await database
      .select({
        email: dbSchema.user.email,
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
      const email = normalizeEmail(row.email);
      if (email) {
        emails.add(email);
      }
    }
  }

  return Array.from(emails);
};

const sendBookingNotificationWithLog = async ({
  database,
  env,
  bookingId,
  organizationId,
  storeId,
  recipientEmail,
  participantName,
  organizationName,
  serviceName,
  participantsCount,
  slotStartLabel,
  slotEndLabel,
  event,
  reason,
  actionUrl,
  actionLabel,
  dedupeKey,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  bookingId: string;
  organizationId: string;
  storeId: string;
  recipientEmail: string;
  participantName: string;
  organizationName: string;
  serviceName: string;
  participantsCount: number;
  slotStartLabel: string;
  slotEndLabel: string;
  event: BookingNotificationEvent;
  reason?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  dedupeKey: string;
}) => {
  const logId = await createNotificationLog({
    database,
    organizationId,
    storeId,
    bookingId,
    eventType: event,
    recipientEmail,
    dedupeKey,
  });
  if (!logId) {
    return;
  }

  try {
    await sendBookingNotificationEmail({
      env,
      inviteeEmail: recipientEmail,
      organizationName,
      participantName,
      serviceName,
      participantsCount,
      slotStartLabel,
      slotEndLabel,
      event,
      reason,
      bookingId,
      actionUrl,
      actionLabel,
    });
    await updateNotificationLog({ database, id: logId, status: 'sent' });
  } catch (error) {
    await updateNotificationLog({
      database,
      id: logId,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/**
 * 予約 lifecycle のメール通知を best-effort で送信します。
 *
 * @remarks
 * 通知失敗は予約状態遷移を巻き戻さず、警告ログに留めます。
 */
export const notifyBookingEmailBestEffort = async ({
  database,
  env,
  bookingId,
  event,
  reason,
  actionUrl,
  actionLabel,
  dedupeKeyExtra,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  bookingId: string;
  event: BookingNotificationEvent;
  reason?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  dedupeKeyExtra?: string | null;
}) => {
  try {
    const context = await getBookingNotificationContext({ database, bookingId });
    if (!context) {
      console.warn(
        `[booking-email] Booking notification context not found. bookingId=${bookingId}`,
      );
      return;
    }
    const recipientEmail = normalizeEmail(context.customerEmail ?? context.participantEmail);
    if (!recipientEmail) {
      console.warn(`[booking-email] Booking email recipient not found. bookingId=${bookingId}`);
      return;
    }

    const timezone =
      assertSupportedTimezone(context.serviceTimezone ?? undefined) ?? DEFAULT_TIMEZONE;
    await sendBookingNotificationWithLog({
      database,
      env,
      bookingId,
      organizationId: context.organizationId,
      storeId: context.storeId,
      recipientEmail,
      organizationName: context.organizationName,
      participantName: context.customerName ?? context.participantName ?? '予約者',
      serviceName: context.serviceName,
      participantsCount: context.participantsCount,
      slotStartLabel: formatDateTimeLabel(context.slotStartAt, timezone),
      slotEndLabel: formatDateTimeLabel(context.slotEndAt, timezone),
      event,
      reason,
      actionUrl,
      actionLabel,
      dedupeKey: `${event}:booking:${bookingId}${
        dedupeKeyExtra ? `:${dedupeKeyExtra}` : ''
      }:customer:${recipientEmail}`,
    });
  } catch (error) {
    console.warn(
      `[booking-email] Failed to send booking notification. bookingId=${bookingId}`,
      error,
    );
  }
};

/**
 * 公開予約を運営側に通知します。送信済み dedupe key がある場合は再送しません。
 */
export const notifyBookingOperationalEmailBestEffort = async ({
  database,
  env,
  bookingId,
  event,
  reason,
  dedupeKeyExtra,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  bookingId: string;
  event: BookingNotificationEvent;
  reason?: string | null;
  dedupeKeyExtra?: string | null;
}) => {
  try {
    const context = await getBookingNotificationContext({ database, bookingId });
    if (!context) {
      console.warn(
        `[booking-email] Booking operational notification context not found. bookingId=${bookingId}`,
      );
      return;
    }

    const timezone =
      assertSupportedTimezone(context.serviceTimezone ?? undefined) ?? DEFAULT_TIMEZONE;
    const recipients = await getOperationalRecipientEmails({
      database,
      organizationId: context.organizationId,
      storeId: context.storeId,
    });

    await Promise.all(
      recipients.map((recipientEmail) =>
        sendBookingNotificationWithLog({
          database,
          env,
          bookingId,
          organizationId: context.organizationId,
          storeId: context.storeId,
          recipientEmail,
          organizationName: context.organizationName,
          participantName: context.customerName ?? context.participantName ?? '予約者',
          serviceName: context.serviceName,
          participantsCount: context.participantsCount,
          slotStartLabel: formatDateTimeLabel(context.slotStartAt, timezone),
          slotEndLabel: formatDateTimeLabel(context.slotEndAt, timezone),
          event,
          reason,
          dedupeKey: `${event}:booking:${bookingId}${
            dedupeKeyExtra ? `:${dedupeKeyExtra}` : ''
          }:ops:${recipientEmail}`,
        }),
      ),
    );
  } catch (error) {
    console.warn(
      `[booking-email] Failed to send booking operational notification. bookingId=${bookingId}`,
      error,
    );
  }
};
