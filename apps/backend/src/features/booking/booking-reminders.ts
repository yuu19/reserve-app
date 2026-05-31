import { and, eq, gt, inArray, lte } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import { DEFAULT_TIMEZONE, BOOKING_STATUS } from '../../domain/booking/constants.js';
import * as dbSchema from '../../infra/db/schema.js';
import { sendBookingNotificationEmail } from '../../infra/email/resend.js';
import { assertSupportedTimezone, formatDateTimeLabel } from '../../shared/date.js';

const DEFAULT_REMINDER_MINUTES_BEFORE = 24 * 60;
const SUPPORTED_REMINDER_MINUTES_BEFORE = [DEFAULT_REMINDER_MINUTES_BEFORE, 3 * 60] as const;

type ReminderPolicyCandidate = {
  id: string | null;
  enabled: boolean;
  minutesBefore: number;
};

const normalizeEmail = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().toLowerCase() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const createReminderLog = async ({
  database,
  organizationId,
  storeId,
  bookingId,
  reminderPolicyId,
  recipientEmail,
  scheduledFor,
  dedupeKey,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
  bookingId: string;
  reminderPolicyId: string | null;
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
    reminderPolicyId,
    channel: 'email',
    recipientEmail,
    status: 'pending',
    dedupeKey,
    scheduledFor,
  });
  return id;
};

const getStoreReminderPolicies = async ({
  database,
  storeIds,
}: {
  database: AuthRuntimeDatabase;
  storeIds: string[];
}) => {
  if (storeIds.length === 0) {
    return {
      storePoliciesByStore: new Map<string, ReminderPolicyCandidate[]>(),
      servicePoliciesByStore: new Map<string, Map<string, ReminderPolicyCandidate[]>>(),
    };
  }

  const rows = await database
    .select({
      id: dbSchema.reminderPolicy.id,
      storeId: dbSchema.reminderPolicy.storeId,
      serviceId: dbSchema.reminderPolicy.serviceId,
      enabled: dbSchema.reminderPolicy.enabled,
      minutesBefore: dbSchema.reminderPolicy.minutesBefore,
    })
    .from(dbSchema.reminderPolicy)
    .where(inArray(dbSchema.reminderPolicy.storeId, storeIds));

  const storePoliciesByStore = new Map<string, ReminderPolicyCandidate[]>();
  const servicePoliciesByStore = new Map<string, Map<string, ReminderPolicyCandidate[]>>();
  for (const row of rows) {
    const policy = {
      id: row.id,
      enabled: row.enabled,
      minutesBefore: row.minutesBefore,
    };
    if (row.serviceId) {
      const servicePolicies = servicePoliciesByStore.get(row.storeId) ?? new Map();
      const policies = servicePolicies.get(row.serviceId) ?? [];
      policies.push(policy);
      servicePolicies.set(row.serviceId, policies);
      servicePoliciesByStore.set(row.storeId, servicePolicies);
      continue;
    }

    const policies = storePoliciesByStore.get(row.storeId) ?? [];
    policies.push(policy);
    storePoliciesByStore.set(row.storeId, policies);
  }
  return {
    storePoliciesByStore,
    servicePoliciesByStore,
  };
};

const resolveReminderPolicyCandidates = (
  policies: ReminderPolicyCandidate[] | undefined,
): ReminderPolicyCandidate[] => {
  if (!policies) {
    return [
      {
        id: null,
        enabled: true,
        minutesBefore: DEFAULT_REMINDER_MINUTES_BEFORE,
      },
    ];
  }

  return policies.filter((policy) => policy.enabled);
};

const pickDueReminderPolicy = ({
  policies,
  now,
  slotStartAt,
}: {
  policies: ReminderPolicyCandidate[];
  now: Date;
  slotStartAt: Date;
}): ReminderPolicyCandidate | null => {
  const duePolicies = policies
    .filter((policy) => policy.minutesBefore > 0)
    .filter((policy) => slotStartAt.getTime() <= now.getTime() + policy.minutesBefore * 60 * 1000)
    .sort((a, b) => a.minutesBefore - b.minutesBefore);

  return duePolicies[0] ?? null;
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
 * 店舗の reminder policy に従い、開始前の confirmed 予約へ reminder を一度だけ送ります。
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
  const dueUntil = new Date(
    now.getTime() + Math.max(...SUPPORTED_REMINDER_MINUTES_BEFORE) * 60 * 1000,
  );
  const rows = await database
    .select({
      bookingId: dbSchema.booking.id,
      organizationId: dbSchema.booking.organizationId,
      storeId: dbSchema.booking.storeId,
      serviceId: dbSchema.booking.serviceId,
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
  const policiesByStore = await getStoreReminderPolicies({
    database,
    storeIds: Array.from(new Set(rows.map((row: { storeId: string }) => row.storeId))),
  });

  for (const row of rows) {
    const recipientEmail = normalizeEmail(row.customerEmail ?? row.participantEmail);
    if (!recipientEmail) {
      continue;
    }

    const duePolicy = pickDueReminderPolicy({
      policies: resolveReminderPolicyCandidates(
        policiesByStore.servicePoliciesByStore.get(row.storeId)?.get(row.serviceId) ??
          policiesByStore.storePoliciesByStore.get(row.storeId),
      ),
      now,
      slotStartAt: row.slotStartAt,
    });
    if (!duePolicy) {
      continue;
    }

    const dedupeKey = `booking-reminder:${row.bookingId}:${duePolicy.minutesBefore}:${recipientEmail}`;
    const logId = await createReminderLog({
      database,
      organizationId: row.organizationId,
      storeId: row.storeId,
      bookingId: row.bookingId,
      reminderPolicyId: duePolicy.id,
      recipientEmail,
      scheduledFor: new Date(row.slotStartAt.getTime() - duePolicy.minutesBefore * 60 * 1000),
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
