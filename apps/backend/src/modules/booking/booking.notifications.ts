import { eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import { DEFAULT_TIMEZONE } from '../../booking/constants.js';
import * as dbSchema from '../../db/schema.js';
import { sendBookingNotificationEmail, type BookingNotificationEvent } from '../../email/resend.js';
import { assertSupportedTimezone, formatDateTimeLabel } from '../shared/date.js';

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
      organizationName: dbSchema.organization.name,
      participantEmail: dbSchema.participant.email,
      participantName: dbSchema.participant.name,
      serviceName: dbSchema.service.name,
      serviceTimezone: dbSchema.service.timezone,
      participantsCount: dbSchema.booking.participantsCount,
      slotStartAt: dbSchema.slot.startAt,
      slotEndAt: dbSchema.slot.endAt,
    })
    .from(dbSchema.booking)
    .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.booking.organizationId))
    .innerJoin(dbSchema.participant, eq(dbSchema.participant.id, dbSchema.booking.participantId))
    .innerJoin(dbSchema.service, eq(dbSchema.service.id, dbSchema.booking.serviceId))
    .innerJoin(dbSchema.slot, eq(dbSchema.slot.id, dbSchema.booking.slotId))
    .where(eq(dbSchema.booking.id, bookingId))
    .limit(1);

  return rows[0] ?? null;
};

export const notifyBookingEmailBestEffort = async ({
  database,
  env,
  bookingId,
  event,
  reason,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  bookingId: string;
  event: BookingNotificationEvent;
  reason?: string | null;
}) => {
  try {
    const context = await getBookingNotificationContext({ database, bookingId });
    if (!context) {
      console.warn(
        `[booking-email] Booking notification context not found. bookingId=${bookingId}`,
      );
      return;
    }

    const timezone =
      assertSupportedTimezone(context.serviceTimezone ?? undefined) ?? DEFAULT_TIMEZONE;
    await sendBookingNotificationEmail({
      env,
      inviteeEmail: context.participantEmail,
      organizationName: context.organizationName,
      participantName: context.participantName,
      serviceName: context.serviceName,
      participantsCount: context.participantsCount,
      slotStartLabel: formatDateTimeLabel(context.slotStartAt, timezone),
      slotEndLabel: formatDateTimeLabel(context.slotEndAt, timezone),
      event,
      reason,
      bookingId,
    });
  } catch (error) {
    console.warn(
      `[booking-email] Failed to send booking notification. bookingId=${bookingId}`,
      error,
    );
  }
};
