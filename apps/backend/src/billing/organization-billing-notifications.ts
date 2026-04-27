import { and, count, desc, eq, or, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import {
  resolveOrganizationBillingPaymentMethodStatus,
  selectOrganizationBillingSummary,
  type OrganizationBillingPaymentMethodStatus,
  type OrganizationBillingPlanState,
  type OrganizationBillingSubscriptionStatus,
} from './organization-billing.js';
import { resolveOrganizationPremiumEntitlementPolicy } from './organization-billing-policy.js';
import { sendTrialEndingReminderEmail } from '../email/resend.js';
import {
  appendOrganizationBillingSignal,
  appendResolvedBillingSignalIfNeeded,
  readOrganizationBillingObservationSnapshot,
} from './organization-billing-observability.js';

export type OrganizationBillingNotificationKind =
  | 'trial_will_end_email'
  | 'trial_will_end'
  | 'unknown';
export type OrganizationBillingCommunicationType = 'trial_will_end' | 'unknown';
export type OrganizationBillingNotificationChannel =
  | 'email'
  | 'in_app'
  | 'web_push'
  | 'unknown';
export type OrganizationBillingNotificationDeliveryState =
  | 'requested'
  | 'retried'
  | 'sent'
  | 'failed'
  | 'unknown';
export type OrganizationBillingNotificationDeliveryOutcome =
  | 'pending'
  | 'delivered'
  | 'failed'
  | 'unknown';
export type InternalTrialReminderDeliveryStatus =
  | 'not_expected'
  | 'missing'
  | 'pending'
  | 'delivered'
  | 'failed'
  | 'unknown';

type OrganizationBillingOwnerContact = {
  userId: string;
  email: string;
  name: string;
};

type OrganizationBillingReminderContext = {
  planState: OrganizationBillingPlanState;
  paymentMethodStatus: OrganizationBillingPaymentMethodStatus;
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
  trialEndsAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

type TrialReminderCopy = {
  actionText: string;
  noteText: string;
};

type TrialReminderDeliveryAuditHistoryEntry = {
  sequenceNumber: number;
  notificationKind: OrganizationBillingNotificationKind;
  communicationType: OrganizationBillingCommunicationType;
  channel: OrganizationBillingNotificationChannel;
  channelLabel: string;
  deliveryState: OrganizationBillingNotificationDeliveryState;
  deliveryOutcome: OrganizationBillingNotificationDeliveryOutcome;
  attemptNumber: number;
  stripeEventId: string | null;
  recipientEmail: string | null;
  planState: OrganizationBillingPlanState;
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
  paymentMethodStatus: OrganizationBillingPaymentMethodStatus;
  trialEndsAt: string | null;
  failureReason: string | null;
  createdAt: string | null;
};

type TrialReminderDeliverySignalSummary = {
  signalStatus: 'pending' | 'mismatch' | 'unavailable' | 'resolved';
  reason: string;
  createdAt: string | null;
};

type TrialReminderWebhookEventSummary = {
  id: string;
  processingStatus: 'processing' | 'processed' | 'failed';
  failureReason: string | null;
  createdAt: string | null;
};

const TRIAL_WILL_END_NOTIFICATION_KIND: OrganizationBillingNotificationKind = 'trial_will_end_email';
type TrialWillEndCommunicationKind = Extract<
  OrganizationBillingNotificationKind,
  'trial_will_end_email' | 'trial_will_end'
>;
const TRIAL_REMINDER_EXPECTATION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const isTrialWillEndCommunicationKind = (
  value: OrganizationBillingNotificationKind,
): value is TrialWillEndCommunicationKind => {
  return value === 'trial_will_end_email' || value === 'trial_will_end';
};

const paymentMethodStatusLabelMap: Record<OrganizationBillingPaymentMethodStatus, string> = {
  not_started: '未登録',
  pending: '確認中',
  registered: '登録済み',
};

const paymentMethodStatusCopyMap: Record<OrganizationBillingPaymentMethodStatus, TrialReminderCopy> = {
  not_started: {
    actionText: '契約ページで支払い方法の登録を完了してください',
    noteText: '支払い方法の登録が完了していない場合、トライアル終了後に無料プランへ戻ることがあります。',
  },
  pending: {
    actionText: '契約ページで登録状況を確認し、未完了であれば支払い方法の登録を完了してください',
    noteText: '支払い方法の登録状況の反映が完了していない場合、トライアル終了後に無料プランへ戻ることがあります。',
  },
  registered: {
    actionText: '追加の登録は不要です。契約ページで継続予定と登録済みの支払い方法をご確認ください',
    noteText: '現在の支払い方法は登録済みです。トライアル終了前に契約内容をご確認ください。',
  },
};

const trialReminderFailureReasonFromError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return 'unexpected_error';
  }

  if (error.message === 'RESEND_CONFIG_MISSING') {
    return 'resend_config_missing';
  }
  if (error.message === 'RESEND_FROM_EMAIL_INVALID') {
    return 'resend_from_email_invalid';
  }
  if (error.message.startsWith('Failed to send trial reminder email via Resend:')) {
    return 'resend_delivery_failed';
  }
  return 'unexpected_error';
};

export const normalizeOrganizationBillingNotificationKind = (
  value: unknown,
): OrganizationBillingNotificationKind => {
  return value === 'trial_will_end_email' || value === 'trial_will_end' ? value : 'unknown';
};

export const normalizeOrganizationBillingNotificationChannel = (
  value: unknown,
): OrganizationBillingNotificationChannel => {
  return value === 'email' || value === 'in_app' || value === 'web_push' ? value : 'unknown';
};

export const normalizeOrganizationBillingNotificationDeliveryState = (
  value: unknown,
): OrganizationBillingNotificationDeliveryState => {
  return value === 'requested' || value === 'retried' || value === 'sent' || value === 'failed'
    ? value
    : 'unknown';
};

export const resolveOrganizationBillingNotificationDeliveryOutcome = (
  deliveryState: OrganizationBillingNotificationDeliveryState,
): OrganizationBillingNotificationDeliveryOutcome => {
  switch (deliveryState) {
    case 'sent':
      return 'delivered';
    case 'failed':
      return 'failed';
    case 'requested':
    case 'retried':
      return 'pending';
    default:
      return 'unknown';
  }
};

export const resolveOrganizationBillingCommunicationType = ({
  notificationKind,
  channel,
}: {
  notificationKind: OrganizationBillingNotificationKind;
  channel: OrganizationBillingNotificationChannel;
}): OrganizationBillingCommunicationType => {
  return channel !== 'unknown' && isTrialWillEndCommunicationKind(notificationKind)
    ? 'trial_will_end'
    : 'unknown';
};

export const resolveOrganizationBillingNotificationChannelLabel = (
  channel: OrganizationBillingNotificationChannel,
) => {
  switch (channel) {
    case 'email':
      return 'メール';
    case 'in_app':
      return 'アプリ内通知';
    case 'web_push':
      return 'プッシュ通知';
    default:
      return '未対応チャネル';
  }
};

const formatTrialEndsAtLabel = (trialEndsAt: string) => {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(trialEndsAt));
};

const toIsoDateString = (value: unknown): string | null => {
  const candidate =
    value instanceof Date ? value : typeof value === 'number' || typeof value === 'string' ? new Date(value) : null;

  if (!candidate || Number.isNaN(candidate.getTime())) {
    return null;
  }

  return candidate.toISOString();
};

const isTrialReminderExpected = ({
  planState,
  trialEndsAt,
  now,
}: {
  planState: OrganizationBillingPlanState;
  trialEndsAt: string | null;
  now: Date;
}) => {
  if (planState !== 'premium_trial' || !trialEndsAt) {
    return false;
  }

  const trialEndsAtDate = new Date(trialEndsAt);
  if (Number.isNaN(trialEndsAtDate.getTime())) {
    return false;
  }

  const diffMs = trialEndsAtDate.getTime() - now.getTime();
  return diffMs > 0 && diffMs <= TRIAL_REMINDER_EXPECTATION_WINDOW_MS;
};

const resolveTrialReminderDeliveryStatus = ({
  expected,
  eventFound,
  latestHistory,
  latestSignal,
}: {
  expected: boolean;
  eventFound: boolean;
  latestHistory: TrialReminderDeliveryAuditHistoryEntry | null;
  latestSignal: TrialReminderDeliverySignalSummary | null;
}): InternalTrialReminderDeliveryStatus => {
  if (latestHistory?.deliveryState === 'sent' || latestSignal?.signalStatus === 'resolved') {
    return 'delivered';
  }

  if (latestSignal?.signalStatus === 'pending') {
    return 'pending';
  }

  if (latestSignal?.signalStatus === 'unavailable') {
    return 'failed';
  }

  if (latestHistory?.deliveryState === 'failed') {
    return expected || eventFound ? 'unknown' : 'not_expected';
  }

  if (!eventFound) {
    return expected ? 'missing' : 'not_expected';
  }

  return 'unknown';
};

const selectOrganizationBillingOwnerContact = async ({
  database,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
}): Promise<OrganizationBillingOwnerContact | null> => {
  const rows = await database
    .select({
      userId: dbSchema.user.id,
      email: dbSchema.user.email,
      name: dbSchema.user.name,
    })
    .from(dbSchema.member)
    .innerJoin(dbSchema.user, eq(dbSchema.member.userId, dbSchema.user.id))
    .where(
      and(
        eq(dbSchema.member.organizationId, organizationId),
        eq(dbSchema.member.role, 'owner'),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
};

const selectNextOrganizationBillingNotificationAttempt = async ({
  database,
  organizationId,
  stripeEventId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  stripeEventId: string;
}) => {
  const rows = await database
    .select({
      count: count(),
    })
    .from(dbSchema.organizationBillingNotification)
    .where(
      and(
        eq(dbSchema.organizationBillingNotification.organizationId, organizationId),
        eq(dbSchema.organizationBillingNotification.notificationKind, TRIAL_WILL_END_NOTIFICATION_KIND),
        eq(dbSchema.organizationBillingNotification.stripeEventId, stripeEventId),
        or(
          eq(dbSchema.organizationBillingNotification.deliveryState, 'requested'),
          eq(dbSchema.organizationBillingNotification.deliveryState, 'retried'),
        ),
      ),
    );

  return Number(rows[0]?.count ?? 0) + 1;
};

const selectNextOrganizationBillingNotificationSequence = async ({
  database,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
}) => {
  const rows = await database
    .select({
      maxSequenceNumber:
        sql<number>`coalesce(max(${dbSchema.organizationBillingNotification.sequenceNumber}), 0)`,
    })
    .from(dbSchema.organizationBillingNotification)
    .where(eq(dbSchema.organizationBillingNotification.organizationId, organizationId));

  return Number(rows[0]?.maxSequenceNumber ?? 0) + 1;
};

const insertOrganizationBillingNotification = async ({
  database,
  organizationId,
  recipientUserId,
  recipientEmail,
  deliveryState,
  attemptNumber,
  stripeEventId,
  stripeCustomerId,
  stripeSubscriptionId,
  planState,
  subscriptionStatus,
  paymentMethodStatus,
  trialEndsAt,
  failureReason,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  deliveryState: OrganizationBillingNotificationDeliveryState;
  attemptNumber: number;
  stripeEventId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  planState: OrganizationBillingPlanState;
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
  paymentMethodStatus: OrganizationBillingPaymentMethodStatus;
  trialEndsAt: string | null;
  failureReason?: string | null;
}) => {
  const sequenceNumber = await selectNextOrganizationBillingNotificationSequence({
    database,
    organizationId,
  });

  await database.insert(dbSchema.organizationBillingNotification).values({
    id: crypto.randomUUID(),
    organizationId,
    recipientUserId: recipientUserId ?? null,
    notificationKind: TRIAL_WILL_END_NOTIFICATION_KIND,
    channel: 'email',
    sequenceNumber,
    deliveryState,
    attemptNumber,
    stripeEventId,
    stripeCustomerId: stripeCustomerId ?? null,
    stripeSubscriptionId: stripeSubscriptionId ?? null,
    recipientEmail: recipientEmail ?? null,
    planState,
    subscriptionStatus,
    paymentMethodStatus,
    trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null,
    failureReason: failureReason ?? null,
  });
};

export const resolveOrganizationTrialReminderContext = async ({
  database,
  env,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
}): Promise<OrganizationBillingReminderContext | null> => {
  const billing = await selectOrganizationBillingSummary(database, organizationId);
  if (!billing) {
    return null;
  }

  const paymentMethodStatus = await resolveOrganizationBillingPaymentMethodStatus({
    env,
    planCode: billing.planCode,
    stripeCustomerId: billing.stripeCustomerId ?? null,
  });
  const policy = resolveOrganizationPremiumEntitlementPolicy({
    planCode: billing.planCode,
    subscriptionStatus: billing.subscriptionStatus,
    paymentMethodStatus,
    currentPeriodEnd:
      billing.currentPeriodEnd instanceof Date ? billing.currentPeriodEnd.toISOString() : null,
    stripePriceId: billing.stripePriceId ?? null,
    env,
  });

  return {
    planState: policy.planState,
    paymentMethodStatus: policy.paymentMethodStatus,
    subscriptionStatus: billing.subscriptionStatus,
    trialEndsAt: policy.trialEndsAt,
    stripeCustomerId: billing.stripeCustomerId ?? null,
    stripeSubscriptionId: billing.stripeSubscriptionId ?? null,
  };
};

export const readTrialReminderDeliveryAuditInspection = async ({
  database,
  organizationId,
  planState,
  trialEndsAt,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  planState: OrganizationBillingPlanState;
  trialEndsAt: string | null;
  now?: Date;
}) => {
  const [historyRows, latestSignalRows, latestEventRows] = await Promise.all([
    database
      .select({
        sequenceNumber: dbSchema.organizationBillingNotification.sequenceNumber,
        notificationKind: dbSchema.organizationBillingNotification.notificationKind,
        channel: dbSchema.organizationBillingNotification.channel,
        deliveryState: dbSchema.organizationBillingNotification.deliveryState,
        attemptNumber: dbSchema.organizationBillingNotification.attemptNumber,
        stripeEventId: dbSchema.organizationBillingNotification.stripeEventId,
        recipientEmail: dbSchema.organizationBillingNotification.recipientEmail,
        planState: dbSchema.organizationBillingNotification.planState,
        subscriptionStatus: dbSchema.organizationBillingNotification.subscriptionStatus,
        paymentMethodStatus: dbSchema.organizationBillingNotification.paymentMethodStatus,
        trialEndsAt: dbSchema.organizationBillingNotification.trialEndsAt,
        failureReason: dbSchema.organizationBillingNotification.failureReason,
        createdAt: dbSchema.organizationBillingNotification.createdAt,
      })
      .from(dbSchema.organizationBillingNotification)
      .where(
        and(
          eq(dbSchema.organizationBillingNotification.organizationId, organizationId),
          or(
            eq(dbSchema.organizationBillingNotification.notificationKind, 'trial_will_end_email'),
            eq(dbSchema.organizationBillingNotification.notificationKind, 'trial_will_end'),
          ),
        ),
      )
      .orderBy(dbSchema.organizationBillingNotification.sequenceNumber),
    database
      .select({
        signalStatus: dbSchema.organizationBillingSignal.signalStatus,
        reason: dbSchema.organizationBillingSignal.reason,
        createdAt: dbSchema.organizationBillingSignal.createdAt,
      })
      .from(dbSchema.organizationBillingSignal)
      .where(
        and(
          eq(dbSchema.organizationBillingSignal.organizationId, organizationId),
          eq(dbSchema.organizationBillingSignal.signalKind, 'notification_delivery'),
          eq(dbSchema.organizationBillingSignal.sourceKind, 'trial_will_end_email'),
        ),
      )
      .orderBy(desc(dbSchema.organizationBillingSignal.sequenceNumber))
      .limit(1),
    database
      .select({
        id: dbSchema.stripeWebhookEvent.id,
        processingStatus: dbSchema.stripeWebhookEvent.processingStatus,
        failureReason: dbSchema.stripeWebhookEvent.failureReason,
        createdAt: dbSchema.stripeWebhookEvent.createdAt,
      })
      .from(dbSchema.stripeWebhookEvent)
      .where(
        and(
          eq(dbSchema.stripeWebhookEvent.organizationId, organizationId),
          eq(dbSchema.stripeWebhookEvent.eventType, 'customer.subscription.trial_will_end'),
        ),
      )
      .orderBy(desc(dbSchema.stripeWebhookEvent.createdAt))
      .limit(1),
  ]);

  const history = historyRows.map((
    row: (typeof historyRows)[number],
  ): TrialReminderDeliveryAuditHistoryEntry => {
    const notificationKind = normalizeOrganizationBillingNotificationKind(row.notificationKind);
    const channel = normalizeOrganizationBillingNotificationChannel(row.channel);
    const deliveryState = normalizeOrganizationBillingNotificationDeliveryState(row.deliveryState);

    return {
      sequenceNumber: row.sequenceNumber,
      notificationKind,
      communicationType: resolveOrganizationBillingCommunicationType({
        notificationKind,
        channel,
      }),
      channel,
      channelLabel: resolveOrganizationBillingNotificationChannelLabel(channel),
      deliveryState,
      deliveryOutcome: resolveOrganizationBillingNotificationDeliveryOutcome(deliveryState),
      attemptNumber: row.attemptNumber,
      stripeEventId: row.stripeEventId ?? null,
      recipientEmail: row.recipientEmail ?? null,
      planState: row.planState as OrganizationBillingPlanState,
      subscriptionStatus: row.subscriptionStatus as OrganizationBillingSubscriptionStatus,
      paymentMethodStatus: row.paymentMethodStatus as OrganizationBillingPaymentMethodStatus,
      trialEndsAt: toIsoDateString(row.trialEndsAt),
      failureReason: row.failureReason ?? null,
      createdAt: toIsoDateString(row.createdAt),
    };
  });

  const latestHistory = history.at(-1) ?? null;
  const latestSignalRow = latestSignalRows[0] ?? null;
  const latestSignal = latestSignalRow
    ? ({
        signalStatus: latestSignalRow.signalStatus,
        reason: latestSignalRow.reason,
        createdAt: toIsoDateString(latestSignalRow.createdAt),
      } satisfies TrialReminderDeliverySignalSummary)
    : null;
  const latestEventRow = latestEventRows[0] ?? null;
  const latestEvent = latestEventRow
    ? ({
        id: latestEventRow.id,
        processingStatus: latestEventRow.processingStatus,
        failureReason: latestEventRow.failureReason ?? null,
        createdAt: toIsoDateString(latestEventRow.createdAt),
      } satisfies TrialReminderWebhookEventSummary)
    : null;
  const expected = isTrialReminderExpected({
    planState,
    trialEndsAt,
    now,
  });
  const eventFound = Boolean(
    latestEvent
    || history.find(
      (entry: TrialReminderDeliveryAuditHistoryEntry) =>
        entry.stripeEventId && entry.stripeEventId.length > 0,
    ),
  );
  const latestFailedHistory = [...history]
    .reverse()
    .find(
      (entry: TrialReminderDeliveryAuditHistoryEntry) =>
        entry.deliveryState === 'failed' && entry.failureReason,
    );
  const latestFailureReason =
    latestFailedHistory?.failureReason
    ?? latestEvent?.failureReason
    ?? (latestSignal?.signalStatus === 'pending' || latestSignal?.signalStatus === 'unavailable'
      ? latestSignal.reason
      : null);
  const status = resolveTrialReminderDeliveryStatus({
    expected,
    eventFound,
    latestHistory,
    latestSignal,
  });

  return {
    reminderDelivery: {
      status,
      expected,
      eventFound,
      outcomeKnown: status === 'delivered' || status === 'failed',
      latestEventId: latestEvent?.id ?? latestHistory?.stripeEventId ?? null,
      latestEventProcessingStatus: latestEvent?.processingStatus ?? null,
      latestEventAt: latestEvent?.createdAt ?? null,
      latestSignalStatus: latestSignal?.signalStatus ?? null,
      latestSignalReason: latestSignal?.reason ?? null,
      latestFailureReason: latestFailureReason ?? null,
      history,
    },
  };
};

export const sendOrganizationTrialWillEndReminder = async ({
  database,
  env,
  organizationId,
  stripeEventId,
  stripeCustomerId,
  stripeSubscriptionId,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  stripeEventId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<
  | { ok: true; reminderSent: true }
  | { ok: true; reminderSent: false }
  | { ok: false; retryable: boolean; message: string; failureReason: string }
> => {
  const reminderContext = await resolveOrganizationTrialReminderContext({
    database,
    env,
    organizationId,
  });
  if (
    !reminderContext
    || reminderContext.planState !== 'premium_trial'
    || !reminderContext.trialEndsAt
  ) {
    return { ok: true, reminderSent: false };
  }

  const owner = await selectOrganizationBillingOwnerContact({
    database,
    organizationId,
  });
  if (!owner) {
    const appSnapshot = await readOrganizationBillingObservationSnapshot({
      database,
      env,
      organizationId,
    });
    const attemptNumber = await selectNextOrganizationBillingNotificationAttempt({
      database,
      organizationId,
      stripeEventId,
    });
    await insertOrganizationBillingNotification({
      database,
      organizationId,
      deliveryState: attemptNumber === 1 ? 'requested' : 'retried',
      attemptNumber,
      stripeEventId,
      stripeCustomerId: stripeCustomerId ?? reminderContext.stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId ?? reminderContext.stripeSubscriptionId,
      planState: reminderContext.planState,
      subscriptionStatus: reminderContext.subscriptionStatus,
      paymentMethodStatus: reminderContext.paymentMethodStatus,
      trialEndsAt: reminderContext.trialEndsAt,
      failureReason: 'owner_not_found',
    });
    await insertOrganizationBillingNotification({
      database,
      organizationId,
      deliveryState: 'failed',
      attemptNumber,
      stripeEventId,
      stripeCustomerId: stripeCustomerId ?? reminderContext.stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId ?? reminderContext.stripeSubscriptionId,
      planState: reminderContext.planState,
      subscriptionStatus: reminderContext.subscriptionStatus,
      paymentMethodStatus: reminderContext.paymentMethodStatus,
      trialEndsAt: reminderContext.trialEndsAt,
      failureReason: 'owner_not_found',
    });
    await appendOrganizationBillingSignal({
      database,
      organizationId,
      signalKind: 'notification_delivery',
      signalStatus: 'unavailable',
      sourceKind: 'trial_will_end_email',
      reason: 'owner_not_found',
      appSnapshot,
      stripeEventId,
      stripeCustomerId: stripeCustomerId ?? reminderContext.stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId ?? reminderContext.stripeSubscriptionId,
    });
    return {
      ok: false,
      retryable: false,
      message: 'Organization owner could not be resolved for trial reminder delivery.',
      failureReason: 'owner_not_found',
    };
  }

  const attemptNumber = await selectNextOrganizationBillingNotificationAttempt({
    database,
    organizationId,
    stripeEventId,
  });
  await insertOrganizationBillingNotification({
    database,
    organizationId,
    recipientUserId: owner.userId,
    recipientEmail: owner.email,
    deliveryState: attemptNumber === 1 ? 'requested' : 'retried',
    attemptNumber,
    stripeEventId,
    stripeCustomerId: stripeCustomerId ?? reminderContext.stripeCustomerId,
    stripeSubscriptionId: stripeSubscriptionId ?? reminderContext.stripeSubscriptionId,
    planState: reminderContext.planState,
    subscriptionStatus: reminderContext.subscriptionStatus,
    paymentMethodStatus: reminderContext.paymentMethodStatus,
    trialEndsAt: reminderContext.trialEndsAt,
  });

  try {
    const reminderCopy = paymentMethodStatusCopyMap[reminderContext.paymentMethodStatus];
    await sendTrialEndingReminderEmail({
      env,
      inviteeEmail: owner.email,
      organizationName: (
        await database
          .select({ name: dbSchema.organization.name })
          .from(dbSchema.organization)
          .where(eq(dbSchema.organization.id, organizationId))
          .limit(1)
      )[0]?.name ?? 'Your organization',
      ownerName: owner.name,
      trialEndsAtLabel: formatTrialEndsAtLabel(reminderContext.trialEndsAt),
      paymentMethodStatusLabel: paymentMethodStatusLabelMap[reminderContext.paymentMethodStatus],
      actionText: reminderCopy.actionText,
      noteText: reminderCopy.noteText,
    });

    await insertOrganizationBillingNotification({
      database,
      organizationId,
      recipientUserId: owner.userId,
      recipientEmail: owner.email,
      deliveryState: 'sent',
      attemptNumber,
      stripeEventId,
      stripeCustomerId: stripeCustomerId ?? reminderContext.stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId ?? reminderContext.stripeSubscriptionId,
      planState: reminderContext.planState,
      subscriptionStatus: reminderContext.subscriptionStatus,
      paymentMethodStatus: reminderContext.paymentMethodStatus,
      trialEndsAt: reminderContext.trialEndsAt,
    });

    const appSnapshot = await readOrganizationBillingObservationSnapshot({
      database,
      env,
      organizationId,
    });
    await appendResolvedBillingSignalIfNeeded({
      database,
      organizationId,
      signalKind: 'notification_delivery',
      sourceKind: 'trial_will_end_email',
      reason: 'trial_reminder_delivery_succeeded',
      appSnapshot,
      stripeEventId,
      stripeCustomerId: stripeCustomerId ?? reminderContext.stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId ?? reminderContext.stripeSubscriptionId,
    });

    return { ok: true, reminderSent: true };
  } catch (error) {
    const failureReason = trialReminderFailureReasonFromError(error);
    await insertOrganizationBillingNotification({
      database,
      organizationId,
      recipientUserId: owner.userId,
      recipientEmail: owner.email,
      deliveryState: 'failed',
      attemptNumber,
      stripeEventId,
      stripeCustomerId: stripeCustomerId ?? reminderContext.stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId ?? reminderContext.stripeSubscriptionId,
      planState: reminderContext.planState,
      subscriptionStatus: reminderContext.subscriptionStatus,
      paymentMethodStatus: reminderContext.paymentMethodStatus,
      trialEndsAt: reminderContext.trialEndsAt,
      failureReason,
    });

    const appSnapshot = await readOrganizationBillingObservationSnapshot({
      database,
      env,
      organizationId,
    });
    await appendOrganizationBillingSignal({
      database,
      organizationId,
      signalKind: 'notification_delivery',
      signalStatus: failureReason === 'resend_delivery_failed' ? 'pending' : 'unavailable',
      sourceKind: 'trial_will_end_email',
      reason: failureReason,
      appSnapshot,
      stripeEventId,
      stripeCustomerId: stripeCustomerId ?? reminderContext.stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId ?? reminderContext.stripeSubscriptionId,
    });

    return {
      ok: false,
      retryable: failureReason === 'resend_delivery_failed',
      message: `Trial reminder email delivery failed: ${failureReason}`,
      failureReason,
    };
  }
};
