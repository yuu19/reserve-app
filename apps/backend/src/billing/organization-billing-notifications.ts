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
import { sendBillingPaymentIssueEmail, sendTrialEndingReminderEmail } from '../email/resend.js';
import {
  appendOrganizationBillingSignal,
  appendResolvedBillingSignalIfNeeded,
  readOrganizationBillingObservationSnapshot,
} from './organization-billing-observability.js';

export type OrganizationBillingNotificationKind =
  | 'trial_will_end_email'
  | 'trial_will_end'
  | 'payment_failed_email'
  | 'payment_action_required_email'
  | 'past_due_grace_reminder_email'
  | 'unknown';
export type OrganizationBillingCommunicationType = 'trial_will_end' | 'payment_issue' | 'unknown';
export type OrganizationBillingNotificationChannel = 'email' | 'in_app' | 'web_push' | 'unknown';
export type OrganizationBillingNotificationDeliveryState =
  | 'requested'
  | 'retried'
  | 'sent'
  | 'failed'
  | 'skipped'
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

export type OrganizationBillingOwnerContact = {
  userId: string;
  email: string;
  name: string;
};

export type OrganizationBillingPaymentIssueNotificationRecipientAttempt = {
  sequenceNumber?: number | null;
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  deliveryState: OrganizationBillingNotificationDeliveryState | string;
  attemptNumber: number;
};

export type OrganizationBillingPaymentIssueNotificationRecipientPlan = {
  owner: OrganizationBillingOwnerContact;
  action: 'send' | 'skip';
  deliveryState: 'requested' | 'retried' | 'skipped';
  attemptNumber: number;
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

const TRIAL_WILL_END_NOTIFICATION_KIND: OrganizationBillingNotificationKind =
  'trial_will_end_email';
const paymentIssueNotificationKinds = new Set<OrganizationBillingNotificationKind>([
  'payment_failed_email',
  'payment_action_required_email',
  'past_due_grace_reminder_email',
]);
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

const paymentMethodStatusCopyMap: Record<
  OrganizationBillingPaymentMethodStatus,
  TrialReminderCopy
> = {
  not_started: {
    actionText: '契約ページで支払い方法の登録を完了してください',
    noteText:
      '支払い方法の登録が完了していない場合、トライアル終了後に無料プランへ戻ることがあります。',
  },
  pending: {
    actionText: '契約ページで登録状況を確認し、未完了であれば支払い方法の登録を完了してください',
    noteText:
      '支払い方法の登録状況の反映が完了していない場合、トライアル終了後に無料プランへ戻ることがあります。',
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
  if (error.message.startsWith('Failed to send billing payment issue email via Resend:')) {
    return 'resend_delivery_failed';
  }
  return 'unexpected_error';
};

export const normalizeOrganizationBillingNotificationKind = (
  value: unknown,
): OrganizationBillingNotificationKind => {
  return value === 'trial_will_end_email' ||
    value === 'trial_will_end' ||
    value === 'payment_failed_email' ||
    value === 'payment_action_required_email' ||
    value === 'past_due_grace_reminder_email'
    ? value
    : 'unknown';
};

export const normalizeOrganizationBillingNotificationChannel = (
  value: unknown,
): OrganizationBillingNotificationChannel => {
  return value === 'email' || value === 'in_app' || value === 'web_push' ? value : 'unknown';
};

export const normalizeOrganizationBillingNotificationDeliveryState = (
  value: unknown,
): OrganizationBillingNotificationDeliveryState => {
  return value === 'requested' ||
    value === 'retried' ||
    value === 'sent' ||
    value === 'failed' ||
    value === 'skipped'
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
    case 'skipped':
      return 'delivered';
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
  if (channel === 'unknown') {
    return 'unknown';
  }
  if (isTrialWillEndCommunicationKind(notificationKind)) {
    return 'trial_will_end';
  }
  if (paymentIssueNotificationKinds.has(notificationKind)) {
    return 'payment_issue';
  }
  return 'unknown';
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
    value instanceof Date
      ? value
      : typeof value === 'number' || typeof value === 'string'
        ? new Date(value)
        : null;

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
      and(eq(dbSchema.member.organizationId, organizationId), eq(dbSchema.member.role, 'owner')),
    )
    .limit(1);

  return rows[0] ?? null;
};

const selectOrganizationBillingVerifiedOwnerContacts = async ({
  database,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
}): Promise<OrganizationBillingOwnerContact[]> => {
  return database
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
        eq(dbSchema.user.emailVerified, true),
      ),
    );
};

const matchesNotificationRecipient = (
  attempt: OrganizationBillingPaymentIssueNotificationRecipientAttempt,
  owner: Pick<OrganizationBillingOwnerContact, 'userId' | 'email'>,
) => {
  return attempt.recipientUserId === owner.userId || attempt.recipientEmail === owner.email;
};

export const resolveOrganizationBillingPaymentIssueNotificationRecipientPlans = ({
  owners,
  attempts,
}: {
  owners: OrganizationBillingOwnerContact[];
  attempts: OrganizationBillingPaymentIssueNotificationRecipientAttempt[];
}): OrganizationBillingPaymentIssueNotificationRecipientPlan[] => {
  return owners.map((owner) => {
    const ownerAttempts = attempts
      .filter((attempt) => matchesNotificationRecipient(attempt, owner))
      .sort((first, second) => {
        const sequenceDelta = (second.sequenceNumber ?? 0) - (first.sequenceNumber ?? 0);
        return sequenceDelta !== 0 ? sequenceDelta : second.attemptNumber - first.attemptNumber;
      });
    const latestDeliveryState = ownerAttempts[0]
      ? normalizeOrganizationBillingNotificationDeliveryState(ownerAttempts[0].deliveryState)
      : null;
    const maxAttemptNumber = ownerAttempts.reduce(
      (maxAttempt, attempt) => Math.max(maxAttempt, attempt.attemptNumber),
      0,
    );
    const attemptNumber = maxAttemptNumber + 1;

    if (latestDeliveryState === 'sent' || latestDeliveryState === 'skipped') {
      return {
        owner,
        action: 'skip',
        deliveryState: 'skipped',
        attemptNumber,
      };
    }

    return {
      owner,
      action: 'send',
      deliveryState: maxAttemptNumber === 0 ? 'requested' : 'retried',
      attemptNumber,
    };
  });
};

const selectNextOrganizationBillingNotificationAttempt = async ({
  database,
  organizationId,
  stripeEventId,
  notificationKind = TRIAL_WILL_END_NOTIFICATION_KIND,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  stripeEventId: string;
  notificationKind?: OrganizationBillingNotificationKind;
}) => {
  const rows = await database
    .select({
      count: count(),
    })
    .from(dbSchema.organizationBillingNotification)
    .where(
      and(
        eq(dbSchema.organizationBillingNotification.organizationId, organizationId),
        eq(dbSchema.organizationBillingNotification.notificationKind, notificationKind),
        eq(dbSchema.organizationBillingNotification.stripeEventId, stripeEventId),
        or(
          eq(dbSchema.organizationBillingNotification.deliveryState, 'requested'),
          eq(dbSchema.organizationBillingNotification.deliveryState, 'retried'),
        ),
      ),
    );

  return Number(rows[0]?.count ?? 0) + 1;
};

const selectPaymentIssueNotificationRecipientAttempts = async ({
  database,
  organizationId,
  stripeEventId,
  notificationKind,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  stripeEventId: string;
  notificationKind: OrganizationBillingNotificationKind;
}) => {
  return database
    .select({
      sequenceNumber: dbSchema.organizationBillingNotification.sequenceNumber,
      recipientUserId: dbSchema.organizationBillingNotification.recipientUserId,
      recipientEmail: dbSchema.organizationBillingNotification.recipientEmail,
      deliveryState: dbSchema.organizationBillingNotification.deliveryState,
      attemptNumber: dbSchema.organizationBillingNotification.attemptNumber,
    })
    .from(dbSchema.organizationBillingNotification)
    .where(
      and(
        eq(dbSchema.organizationBillingNotification.organizationId, organizationId),
        eq(dbSchema.organizationBillingNotification.notificationKind, notificationKind),
        eq(dbSchema.organizationBillingNotification.stripeEventId, stripeEventId),
      ),
    )
    .orderBy(desc(dbSchema.organizationBillingNotification.sequenceNumber));
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
      maxSequenceNumber: sql<number>`coalesce(max(${dbSchema.organizationBillingNotification.sequenceNumber}), 0)`,
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
  notificationKind = TRIAL_WILL_END_NOTIFICATION_KIND,
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
  notificationKind?: OrganizationBillingNotificationKind;
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
    notificationKind,
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
    pastDueGraceEndsAt:
      billing.pastDueGraceEndsAt instanceof Date ? billing.pastDueGraceEndsAt.toISOString() : null,
    cancelAtPeriodEnd: Boolean(billing.cancelAtPeriodEnd),
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

  const history = historyRows.map(
    (row: (typeof historyRows)[number]): TrialReminderDeliveryAuditHistoryEntry => {
      const notificationKind = normalizeOrganizationBillingNotificationKind(row.notificationKind);
      const channel = normalizeOrganizationBillingNotificationChannel(row.channel);
      const deliveryState = normalizeOrganizationBillingNotificationDeliveryState(
        row.deliveryState,
      );

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
    },
  );

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
    latestEvent ||
    history.find(
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
    latestFailedHistory?.failureReason ??
    latestEvent?.failureReason ??
    (latestSignal?.signalStatus === 'pending' || latestSignal?.signalStatus === 'unavailable'
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
    !reminderContext ||
    reminderContext.planState !== 'premium_trial' ||
    !reminderContext.trialEndsAt
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
      organizationName:
        (
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

export const sendOrganizationPaymentIssueNotification = async ({
  database,
  env,
  organizationId,
  notificationKind,
  stripeEventId,
  stripeCustomerId,
  stripeSubscriptionId,
  stripeInvoiceId,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  notificationKind:
    | 'payment_failed_email'
    | 'payment_action_required_email'
    | 'past_due_grace_reminder_email';
  stripeEventId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeInvoiceId?: string | null;
}): Promise<
  | { ok: true; notificationSent: true }
  | { ok: true; notificationSent: false }
  | { ok: false; retryable: boolean; message: string; failureReason: string }
> => {
  const billing = await selectOrganizationBillingSummary(database, organizationId);
  if (!billing) {
    return { ok: true, notificationSent: false };
  }

  const paymentMethodStatus = await resolveOrganizationBillingPaymentMethodStatus({
    env,
    planCode: billing.planCode,
    stripeCustomerId: billing.stripeCustomerId ?? null,
  });
  const currentPeriodEnd =
    billing.currentPeriodEnd instanceof Date ? billing.currentPeriodEnd.toISOString() : null;
  const pastDueGraceEndsAt =
    billing.pastDueGraceEndsAt instanceof Date ? billing.pastDueGraceEndsAt.toISOString() : null;
  const policy = resolveOrganizationPremiumEntitlementPolicy({
    planCode: billing.planCode,
    subscriptionStatus: billing.subscriptionStatus,
    paymentMethodStatus,
    currentPeriodEnd,
    pastDueGraceEndsAt,
    cancelAtPeriodEnd: Boolean(billing.cancelAtPeriodEnd),
    stripePriceId: billing.stripePriceId ?? null,
    env,
  });

  const owners = await selectOrganizationBillingVerifiedOwnerContacts({
    database,
    organizationId,
  });
  const commonNotificationInput = {
    database,
    organizationId,
    notificationKind,
    stripeEventId,
    stripeCustomerId: stripeCustomerId ?? billing.stripeCustomerId,
    stripeSubscriptionId: stripeSubscriptionId ?? billing.stripeSubscriptionId,
    planState: policy.planState,
    subscriptionStatus: billing.subscriptionStatus,
    paymentMethodStatus,
    trialEndsAt: policy.trialEndsAt,
  };

  if (owners.length === 0) {
    const attemptNumber = await selectNextOrganizationBillingNotificationAttempt({
      database,
      organizationId,
      stripeEventId,
      notificationKind,
    });
    await insertOrganizationBillingNotification({
      ...commonNotificationInput,
      deliveryState: attemptNumber === 1 ? 'requested' : 'retried',
      attemptNumber,
      failureReason: 'verified_owner_not_found',
    });
    await insertOrganizationBillingNotification({
      ...commonNotificationInput,
      attemptNumber,
      deliveryState: 'failed',
      failureReason: 'verified_owner_not_found',
    });
    await appendOrganizationBillingSignal({
      database,
      organizationId,
      signalKind: 'notification_delivery',
      signalStatus: 'unavailable',
      sourceKind: notificationKind,
      reason: 'verified_owner_not_found',
      appSnapshot: await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId,
      }),
      stripeEventId,
      stripeCustomerId: stripeCustomerId ?? billing.stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId ?? billing.stripeSubscriptionId,
    });
    return {
      ok: false,
      retryable: false,
      message: 'Verified organization owner could not be resolved for payment issue notification.',
      failureReason: 'verified_owner_not_found',
    };
  }

  const organizationName =
    (
      await database
        .select({ name: dbSchema.organization.name })
        .from(dbSchema.organization)
        .where(eq(dbSchema.organization.id, organizationId))
        .limit(1)
    )[0]?.name ?? 'Your organization';
  const issueCopy =
    notificationKind === 'payment_action_required_email'
      ? {
          issueTitle: '支払い方法の認証が必要です',
          actionText:
            '契約ページから Stripe の契約管理画面を開き、支払い方法の認証を完了してください。',
          noteText: '認証が完了するまで Premium の利用が停止または制限される場合があります。',
        }
      : notificationKind === 'past_due_grace_reminder_email'
        ? {
            issueTitle: '支払い遅延の猶予期間中です',
            actionText: '猶予期限までに契約ページから支払い方法または請求状況を確認してください。',
            noteText: '猶予期限を過ぎても支払いが回復しない場合、Premium の利用は停止されます。',
          }
        : {
            issueTitle: '支払いを完了できませんでした',
            actionText:
              '契約ページから Stripe の契約管理画面を開き、支払い方法を更新してください。',
            noteText: '支払いが回復すると Premium の利用状態は自動的に再確認されます。',
          };

  let retryableFailureReason: string | null = null;
  let terminalFailureReason: string | null = null;
  let sentCount = 0;
  const previousAttempts = await selectPaymentIssueNotificationRecipientAttempts({
    database,
    organizationId,
    stripeEventId,
    notificationKind,
  });
  const recipientPlans = resolveOrganizationBillingPaymentIssueNotificationRecipientPlans({
    owners,
    attempts: previousAttempts,
  });

  for (const plan of recipientPlans) {
    const owner = plan.owner;
    if (plan.action === 'skip') {
      await insertOrganizationBillingNotification({
        ...commonNotificationInput,
        recipientUserId: owner.userId,
        recipientEmail: owner.email,
        deliveryState: 'skipped',
        attemptNumber: plan.attemptNumber,
      });
      continue;
    }

    await insertOrganizationBillingNotification({
      ...commonNotificationInput,
      recipientUserId: owner.userId,
      recipientEmail: owner.email,
      deliveryState: plan.deliveryState,
      attemptNumber: plan.attemptNumber,
    });

    try {
      await sendBillingPaymentIssueEmail({
        env,
        inviteeEmail: owner.email,
        organizationName,
        ownerName: owner.name,
        issueTitle: issueCopy.issueTitle,
        actionText: issueCopy.actionText,
        noteText: issueCopy.noteText,
        invoiceReference: stripeInvoiceId ?? null,
        graceEndsAtLabel: pastDueGraceEndsAt ? formatTrialEndsAtLabel(pastDueGraceEndsAt) : null,
      });

      await insertOrganizationBillingNotification({
        ...commonNotificationInput,
        recipientUserId: owner.userId,
        recipientEmail: owner.email,
        attemptNumber: plan.attemptNumber,
        deliveryState: 'sent',
      });
      sentCount += 1;
    } catch (error) {
      const failureReason = trialReminderFailureReasonFromError(error);
      await insertOrganizationBillingNotification({
        ...commonNotificationInput,
        recipientUserId: owner.userId,
        recipientEmail: owner.email,
        attemptNumber: plan.attemptNumber,
        deliveryState: 'failed',
        failureReason,
      });
      await appendOrganizationBillingSignal({
        database,
        organizationId,
        signalKind: 'notification_delivery',
        signalStatus: failureReason === 'resend_delivery_failed' ? 'pending' : 'unavailable',
        sourceKind: notificationKind,
        reason: failureReason,
        appSnapshot: await readOrganizationBillingObservationSnapshot({
          database,
          env,
          organizationId,
        }),
        stripeEventId,
        stripeCustomerId: stripeCustomerId ?? billing.stripeCustomerId,
        stripeSubscriptionId: stripeSubscriptionId ?? billing.stripeSubscriptionId,
      });

      if (failureReason === 'resend_delivery_failed') {
        retryableFailureReason ??= failureReason;
      } else {
        terminalFailureReason ??= failureReason;
      }
    }
  }

  if (retryableFailureReason || terminalFailureReason) {
    const failureReason = retryableFailureReason ?? terminalFailureReason ?? 'unexpected_error';
    return {
      ok: false,
      retryable: Boolean(retryableFailureReason),
      message: `Payment issue email delivery failed: ${failureReason}`,
      failureReason,
    };
  }

  if (sentCount > 0) {
    await appendResolvedBillingSignalIfNeeded({
      database,
      organizationId,
      signalKind: 'notification_delivery',
      sourceKind: notificationKind,
      reason: 'payment_issue_notification_delivery_succeeded',
      appSnapshot: await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId,
      }),
      stripeEventId,
      stripeCustomerId: stripeCustomerId ?? billing.stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId ?? billing.stripeSubscriptionId,
    });
  }
  return { ok: true, notificationSent: sentCount > 0 };
};
