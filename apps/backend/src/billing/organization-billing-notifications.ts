import { and, count, eq, or, sql } from 'drizzle-orm';
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

export type OrganizationBillingNotificationKind = 'trial_will_end_email';
export type OrganizationBillingNotificationChannel = 'email';
export type OrganizationBillingNotificationDeliveryState =
  | 'requested'
  | 'retried'
  | 'sent'
  | 'failed';

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

const TRIAL_WILL_END_NOTIFICATION_KIND: OrganizationBillingNotificationKind = 'trial_will_end_email';

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

const formatTrialEndsAtLabel = (trialEndsAt: string) => {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(trialEndsAt));
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
