import { and, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import * as dbSchema from '../../infra/db/schema.js';
import {
  isBillingSubscriptionStatus,
  resolveBillingIntervalFromPriceId,
} from './organization-billing.js';
import {
  applyReserveAppBillingV2TrialCompletion,
  markReserveAppBillingV2Reconciled,
  upsertReserveAppBillingV2SubscriptionState,
} from '../../infra/billing/reserve-app-billing-v2-source.js';
import {
  appendOrganizationBillingAuditEvent,
  appendOrganizationBillingSignal,
  appendResolvedBillingSignalIfNeeded,
  evaluateReconciliationMismatchReason,
  readOrganizationBillingObservationSnapshot,
} from './organization-billing-observability.js';
import { readStripeSubscriptionSummaryById } from '../../infra/payment/stripe.js';
import { sendOrganizationPaymentIssueNotification } from './organization-billing-notifications.js';

const PAST_DUE_GRACE_REMINDER_OFFSET_MS = 3 * 24 * 60 * 60 * 1000;
const PAST_DUE_GRACE_REMINDER_WINDOW_MS = 60 * 60 * 1000;

export const resolvePastDueGraceReminderStripeEventId = ({
  organizationId,
  pastDueGraceEndsAt,
}: {
  organizationId: string;
  pastDueGraceEndsAt: Date;
}) => `scheduled_past_due_grace_reminder:${organizationId}:${pastDueGraceEndsAt.getTime()}`;

export const isPastDueGraceReminderDue = ({
  pastDueGraceEndsAt,
  now = new Date(),
  windowMs = PAST_DUE_GRACE_REMINDER_WINDOW_MS,
}: {
  pastDueGraceEndsAt: Date | null;
  now?: Date;
  windowMs?: number;
}) => {
  if (!pastDueGraceEndsAt || Number.isNaN(pastDueGraceEndsAt.getTime())) {
    return false;
  }

  const reminderAt = pastDueGraceEndsAt.getTime() - PAST_DUE_GRACE_REMINDER_OFFSET_MS;
  return reminderAt >= now.getTime() && reminderAt < now.getTime() + windowMs;
};

export const completeExpiredOrganizationPremiumTrials = async ({
  database,
  env,
  now = new Date(),
  limit = 50,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  now?: Date;
  limit?: number;
}) => {
  const rows = await database
    .select({
      organizationId: dbSchema.billingAccount.subjectId,
    })
    .from(dbSchema.billingSubscription)
    .innerJoin(
      dbSchema.billingAccount,
      eq(dbSchema.billingSubscription.billingAccountId, dbSchema.billingAccount.id),
    )
    .where(
      and(
        eq(dbSchema.billingAccount.subjectType, 'organization'),
        eq(dbSchema.billingSubscription.planCode, 'premium'),
        eq(dbSchema.billingSubscription.status, 'trialing'),
        lte(dbSchema.billingSubscription.currentPeriodEnd, now),
        isNull(dbSchema.billingAccount.providerCustomerId),
        isNull(dbSchema.billingSubscription.providerSubscriptionId),
      ),
    )
    .limit(limit);

  let completed = 0;
  let failed = 0;

  for (const row of rows) {
    const previousBillingSnapshot = await readOrganizationBillingObservationSnapshot({
      database,
      env,
      organizationId: row.organizationId,
    });
    const completion = await applyReserveAppBillingV2TrialCompletion({
      database,
      env,
      organizationId: row.organizationId,
      now,
    });
    if (!completion.ok) {
      failed += 1;
      const currentBillingSnapshot = await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId: row.organizationId,
      });
      await appendOrganizationBillingSignal({
        database,
        organizationId: row.organizationId,
        signalKind: 'reconciliation',
        signalStatus: completion.status === 503 ? 'pending' : 'unavailable',
        sourceKind: 'scheduled_trial_completion',
        reason:
          completion.status === 503
            ? 'trial_completion_pending'
            : 'trial_completion_not_ready_or_unavailable',
        appSnapshot: currentBillingSnapshot,
      });
      continue;
    }

    completed += 1;
    const nextBillingSnapshot = await readOrganizationBillingObservationSnapshot({
      database,
      env,
      organizationId: row.organizationId,
    });
    await appendOrganizationBillingAuditEvent({
      database,
      organizationId: row.organizationId,
      sourceKind: 'trial_completion',
      previousSnapshot: previousBillingSnapshot,
      nextSnapshot: nextBillingSnapshot,
      sourceContext: completion.message,
    });
    await appendResolvedBillingSignalIfNeeded({
      database,
      organizationId: row.organizationId,
      signalKind: 'reconciliation',
      sourceKind: 'scheduled_trial_completion',
      reason: 'trial_completion_applied',
      appSnapshot: nextBillingSnapshot,
    });
  }

  return {
    scanned: rows.length,
    completed,
    failed,
  };
};

export const sendPastDueGraceExpiryReminders = async ({
  database,
  env,
  now = new Date(),
  limit = 50,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  now?: Date;
  limit?: number;
}) => {
  const reminderWindowStart = new Date(now.getTime() + PAST_DUE_GRACE_REMINDER_OFFSET_MS);
  const reminderWindowEnd = new Date(
    reminderWindowStart.getTime() + PAST_DUE_GRACE_REMINDER_WINDOW_MS,
  );
  const rows = await database
    .select({
      organizationId: dbSchema.billingAccount.subjectId,
      stripeCustomerId: dbSchema.billingAccount.providerCustomerId,
      stripeSubscriptionId: dbSchema.billingSubscription.providerSubscriptionId,
      pastDueGraceEndsAt: dbSchema.billingPaymentIssue.pastDueGraceEndsAt,
    })
    .from(dbSchema.billingPaymentIssue)
    .innerJoin(
      dbSchema.billingAccount,
      eq(dbSchema.billingPaymentIssue.billingAccountId, dbSchema.billingAccount.id),
    )
    .innerJoin(
      dbSchema.billingSubscription,
      eq(dbSchema.billingPaymentIssue.billingSubscriptionId, dbSchema.billingSubscription.id),
    )
    .where(
      and(
        eq(dbSchema.billingAccount.subjectType, 'organization'),
        eq(dbSchema.billingSubscription.planCode, 'premium'),
        eq(dbSchema.billingSubscription.status, 'past_due'),
        eq(dbSchema.billingPaymentIssue.state, 'past_due_grace_active'),
        gte(dbSchema.billingPaymentIssue.pastDueGraceEndsAt, reminderWindowStart),
        lte(dbSchema.billingPaymentIssue.pastDueGraceEndsAt, reminderWindowEnd),
      ),
    )
    .limit(limit);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.pastDueGraceEndsAt) {
      skipped += 1;
      continue;
    }

    const notification = await sendOrganizationPaymentIssueNotification({
      database,
      env,
      organizationId: row.organizationId,
      notificationKind: 'past_due_grace_reminder_email',
      stripeEventId: resolvePastDueGraceReminderStripeEventId({
        organizationId: row.organizationId,
        pastDueGraceEndsAt: row.pastDueGraceEndsAt,
      }),
      stripeCustomerId: row.stripeCustomerId,
      stripeSubscriptionId: row.stripeSubscriptionId,
    });

    if (!notification.ok) {
      failed += 1;
      continue;
    }
    if (notification.notificationSent) {
      sent += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    scanned: rows.length,
    sent,
    skipped,
    failed,
  };
};

const reconcileOrganizationBillingProviderState = async ({
  database,
  env,
  organizationId,
  stripeSubscriptionId,
  sourceKind,
  now,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  stripeSubscriptionId: string;
  sourceKind: 'reconciliation_targeted' | 'reconciliation_full';
  now: Date;
}) => {
  const previousSnapshot = await readOrganizationBillingObservationSnapshot({
    database,
    env,
    organizationId,
  });

  try {
    const subscription = await readStripeSubscriptionSummaryById({
      env,
      subscriptionId: stripeSubscriptionId,
    });
    const subscriptionStatus = isBillingSubscriptionStatus(subscription.status);
    if (!subscriptionStatus) {
      await appendOrganizationBillingSignal({
        database,
        organizationId,
        signalKind: 'reconciliation',
        signalStatus: 'unavailable',
        sourceKind,
        reason: 'provider_subscription_status_unknown',
        appSnapshot: previousSnapshot,
        stripeCustomerId: subscription.customerId,
        stripeSubscriptionId: subscription.id,
        providerSubscriptionStatus: subscription.status,
      });
      return false;
    }

    const isCanceled = subscriptionStatus === 'canceled';
    await upsertReserveAppBillingV2SubscriptionState({
      database,
      env,
      organizationId,
      planCode: isCanceled ? 'free' : 'premium',
      stripeCustomerId: subscription.customerId,
      stripeSubscriptionId: isCanceled ? null : subscription.id,
      stripePriceId: isCanceled ? null : subscription.priceId,
      billingInterval: isCanceled
        ? null
        : resolveBillingIntervalFromPriceId(env, subscription.priceId),
      subscriptionStatus: isCanceled ? 'canceled' : subscriptionStatus,
      cancelAtPeriodEnd: isCanceled ? false : subscription.cancelAtPeriodEnd,
      currentPeriodStart: isCanceled ? null : subscription.currentPeriodStart,
      currentPeriodEnd: isCanceled ? null : subscription.currentPeriodEnd,
      now,
    });
    await markReserveAppBillingV2Reconciled({
      database,
      organizationId,
      now,
      reason: sourceKind,
    });

    const nextSnapshot = await readOrganizationBillingObservationSnapshot({
      database,
      env,
      organizationId,
    });
    await appendOrganizationBillingAuditEvent({
      database,
      organizationId,
      sourceKind,
      previousSnapshot,
      nextSnapshot,
      sourceContext: 'provider_subscription_reconciled',
    });

    const mismatch = evaluateReconciliationMismatchReason({
      appSnapshot: nextSnapshot,
      providerSubscription: subscription,
    });
    if (mismatch.reason) {
      await appendOrganizationBillingSignal({
        database,
        organizationId,
        signalKind: 'reconciliation',
        signalStatus: 'mismatch',
        sourceKind,
        reason: mismatch.reason,
        appSnapshot: nextSnapshot,
        stripeCustomerId: subscription.customerId,
        stripeSubscriptionId: subscription.id,
        providerPlanState: mismatch.providerPlanState,
        providerSubscriptionStatus: subscription.status,
      });
    } else {
      await appendResolvedBillingSignalIfNeeded({
        database,
        organizationId,
        signalKind: 'reconciliation',
        sourceKind,
        reason: 'provider_and_app_state_aligned',
        appSnapshot: nextSnapshot,
        stripeCustomerId: subscription.customerId,
        stripeSubscriptionId: subscription.id,
        providerPlanState: mismatch.providerPlanState,
        providerSubscriptionStatus: subscription.status,
      });
    }
    return true;
  } catch {
    await appendOrganizationBillingSignal({
      database,
      organizationId,
      signalKind: 'reconciliation',
      signalStatus: 'unavailable',
      sourceKind,
      reason: 'latest_subscription_lookup_failed',
      appSnapshot: previousSnapshot,
      stripeSubscriptionId,
    });
    return false;
  }
};

export const reconcileRiskyOrganizationBillingStates = async ({
  database,
  env,
  now = new Date(),
  limit = 50,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  now?: Date;
  limit?: number;
}) => {
  if (!env.STRIPE_SECRET_KEY?.trim()) {
    return { scanned: 0, reconciled: 0, failed: 0, skipped: true };
  }

  const rows = await database
    .select({
      organizationId: dbSchema.billingAccount.subjectId,
      stripeSubscriptionId: dbSchema.billingSubscription.providerSubscriptionId,
    })
    .from(dbSchema.billingSubscription)
    .innerJoin(
      dbSchema.billingAccount,
      eq(dbSchema.billingSubscription.billingAccountId, dbSchema.billingAccount.id),
    )
    .where(
      and(
        eq(dbSchema.billingAccount.subjectType, 'organization'),
        inArray(dbSchema.billingSubscription.status, ['past_due', 'unpaid', 'incomplete']),
        isNotNull(dbSchema.billingSubscription.providerSubscriptionId),
      ),
    )
    .limit(limit);

  let reconciled = 0;
  for (const row of rows) {
    if (
      row.stripeSubscriptionId &&
      (await reconcileOrganizationBillingProviderState({
        database,
        env,
        organizationId: row.organizationId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        sourceKind: 'reconciliation_targeted',
        now,
      }))
    ) {
      reconciled += 1;
    }
  }

  return {
    scanned: rows.length,
    reconciled,
    failed: rows.length - reconciled,
    skipped: false,
  };
};

export const reconcileProviderLinkedOrganizationBillingStates = async ({
  database,
  env,
  now = new Date(),
  limit = 200,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  now?: Date;
  limit?: number;
}) => {
  if (!env.STRIPE_SECRET_KEY?.trim()) {
    return { scanned: 0, reconciled: 0, failed: 0, skipped: true };
  }

  const rows = await database
    .select({
      organizationId: dbSchema.billingAccount.subjectId,
      stripeSubscriptionId: dbSchema.billingSubscription.providerSubscriptionId,
    })
    .from(dbSchema.billingSubscription)
    .innerJoin(
      dbSchema.billingAccount,
      eq(dbSchema.billingSubscription.billingAccountId, dbSchema.billingAccount.id),
    )
    .where(
      and(
        eq(dbSchema.billingAccount.subjectType, 'organization'),
        isNotNull(dbSchema.billingSubscription.providerSubscriptionId),
      ),
    )
    .limit(limit);

  let reconciled = 0;
  for (const row of rows) {
    if (
      row.stripeSubscriptionId &&
      (await reconcileOrganizationBillingProviderState({
        database,
        env,
        organizationId: row.organizationId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        sourceKind: 'reconciliation_full',
        now,
      }))
    ) {
      reconciled += 1;
    }
  }

  return {
    scanned: rows.length,
    reconciled,
    failed: rows.length - reconciled,
    skipped: false,
  };
};
