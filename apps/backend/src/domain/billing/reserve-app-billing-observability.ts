import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import * as dbSchema from '../../infra/db/schema.js';
import {
  ensureReserveAppBillingV2State,
  readReserveAppBillingV2Summary,
} from '../../infra/billing/reserve-app-billing-v2-source.js';
import { retryBillingSequenceInsert } from './billing-sequence.js';
import {
  resolveReserveAppBillingPaymentMethodStatus,
  type ReserveAppBillingPaymentMethodStatus,
  type ReserveAppBillingPlanCode,
  type ReserveAppBillingPlanState,
  type ReserveAppBillingSubscriptionStatus,
} from '../../features/billing/policies/reserve-app-billing-policy.js';
import {
  resolveOrganizationPremiumEntitlementPolicy,
  type OrganizationBillingEntitlementState,
  type OrganizationBillingPaidTier,
} from './organization-billing-policy.js';
import type { StripeSubscriptionSummary } from '../../infra/payment/stripe.js';

export type ReserveAppBillingObservationSnapshot = {
  planCode: ReserveAppBillingPlanCode;
  planState: ReserveAppBillingPlanState;
  subscriptionStatus: ReserveAppBillingSubscriptionStatus;
  paymentMethodStatus: ReserveAppBillingPaymentMethodStatus;
  entitlementState: OrganizationBillingEntitlementState;
  paidTier: OrganizationBillingPaidTier | null;
  billingInterval: 'month' | 'year' | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
};

export type ReserveAppBillingAuditSourceKind =
  | 'trial_start'
  | 'paid_checkout_started'
  | 'payment_method_setup_started'
  | 'billing_portal_started'
  | 'payment_method_customer_linked'
  | 'payment_method_registered'
  | 'trial_completion'
  | 'webhook_checkout_completed'
  | 'webhook_subscription_lifecycle'
  | 'webhook_trial_completion'
  | 'webhook_invoice_available'
  | 'webhook_payment_succeeded'
  | 'webhook_payment_failed'
  | 'webhook_payment_action_required'
  | 'reconciliation_targeted'
  | 'reconciliation_full'
  | 'payment_issue_notification'
  | 'billing_profile_readiness_changed';

export type ReserveAppBillingSignalKind =
  | 'reconciliation'
  | 'notification_delivery'
  | 'billing_profile'
  | 'security_audit';
export type ReserveAppBillingSignalStatus = 'pending' | 'mismatch' | 'unavailable' | 'resolved';
export type InternalBillingReconciliationStatus =
  | 'not_applicable'
  | 'aligned'
  | 'mismatch'
  | 'pending'
  | 'unavailable'
  | 'incomplete';

type InternalBillingReconciliationSignalEntry = {
  sequenceNumber: number;
  signalStatus: ReserveAppBillingSignalStatus;
  sourceKind: string;
  reason: string;
  stripeEventId: string | null;
  providerPlanState: ReserveAppBillingPlanState | null;
  providerSubscriptionStatus: ReserveAppBillingSubscriptionStatus | null;
  appPlanState: ReserveAppBillingPlanState;
  appSubscriptionStatus: ReserveAppBillingSubscriptionStatus;
  appPaymentMethodStatus: ReserveAppBillingPaymentMethodStatus;
  appEntitlementState: OrganizationBillingEntitlementState;
  createdAt: string | null;
};

type InternalBillingReconciliationWebhookEventEntry = {
  id: string;
  eventType: string;
  processingStatus: 'processing' | 'processed' | 'failed';
  failureReason: string | null;
  signatureVerificationStatus: string;
  duplicateDetected: boolean;
  duplicateDetectedAt: string | null;
  receiptStatus: string;
  createdAt: string | null;
  processedAt: string | null;
};

type InternalBillingReconciliationWebhookFailureEntry = {
  eventId: string | null;
  eventType: string | null;
  failureStage: string;
  failureReason: string;
  createdAt: string | null;
};

type BillingSnapshotJson = Record<string, unknown>;

export type InternalBillingReconciliationInspection = {
  status: InternalBillingReconciliationStatus;
  comparable: boolean;
  latestSignalStatus: ReserveAppBillingSignalStatus | null;
  latestSignalReason: string | null;
  currentComparison: {
    providerPlanState: ReserveAppBillingPlanState | null;
    providerSubscriptionStatus: ReserveAppBillingSubscriptionStatus | null;
    appPlanState: ReserveAppBillingPlanState;
    appSubscriptionStatus: ReserveAppBillingSubscriptionStatus;
    appPaymentMethodStatus: ReserveAppBillingPaymentMethodStatus;
    appEntitlementState: OrganizationBillingEntitlementState;
  };
  recentSignals: InternalBillingReconciliationSignalEntry[];
  recentWebhookEvents: InternalBillingReconciliationWebhookEventEntry[];
  recentWebhookFailures: InternalBillingReconciliationWebhookFailureEntry[];
};

const resolveProviderPlanState = (
  subscriptionStatus: string | null,
): ReserveAppBillingPlanState | null => {
  if (subscriptionStatus === 'trialing') {
    return 'premium_trial';
  }
  if (
    subscriptionStatus === 'active' ||
    subscriptionStatus === 'past_due' ||
    subscriptionStatus === 'unpaid' ||
    subscriptionStatus === 'incomplete'
  ) {
    return 'premium_paid';
  }
  if (subscriptionStatus === 'canceled') {
    return 'free';
  }
  return null;
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

const toSnapshotJson = (snapshot: BillingSnapshotJson) => JSON.stringify(snapshot);

const parseSnapshotJson = (value: unknown): BillingSnapshotJson => {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeSignalProviderPlanState = (value: unknown): ReserveAppBillingPlanState | null => {
  return value === 'free' || value === 'premium_trial' || value === 'premium_paid' ? value : null;
};

const normalizeSignalProviderSubscriptionStatus = (
  value: unknown,
): ReserveAppBillingSubscriptionStatus | null => {
  return value === 'free' ||
    value === 'trialing' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'canceled' ||
    value === 'unpaid' ||
    value === 'incomplete'
    ? value
    : null;
};

const normalizeSignalAppPlanState = (value: unknown): ReserveAppBillingPlanState => {
  return value === 'premium_trial' || value === 'premium_paid' ? value : 'free';
};

const normalizeSignalAppSubscriptionStatus = (
  value: unknown,
): ReserveAppBillingSubscriptionStatus => {
  return value === 'trialing' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'canceled' ||
    value === 'unpaid' ||
    value === 'incomplete'
    ? value
    : 'free';
};

const normalizeSignalAppPaymentMethodStatus = (
  value: unknown,
): ReserveAppBillingPaymentMethodStatus => {
  return value === 'pending' || value === 'registered' ? value : 'not_started';
};

const normalizeSignalAppEntitlementState = (
  value: unknown,
): OrganizationBillingEntitlementState => {
  return value === 'premium_enabled' ? value : 'free_only';
};

const selectNextBillingAuditSequenceNumber = async ({
  database,
  billingAccountId,
}: {
  database: AuthRuntimeDatabase;
  billingAccountId: string;
}) => {
  const rows = await database
    .select({
      maxSequenceNumber: sql<number>`coalesce(max(${dbSchema.billingAuditEvent.sequenceNumber}), 0)`,
    })
    .from(dbSchema.billingAuditEvent)
    .where(eq(dbSchema.billingAuditEvent.billingAccountId, billingAccountId));

  return Number(rows[0]?.maxSequenceNumber ?? 0) + 1;
};

const selectNextBillingSignalSequenceNumber = async ({
  database,
  billingAccountId,
}: {
  database: AuthRuntimeDatabase;
  billingAccountId: string;
}) => {
  const rows = await database
    .select({
      maxSequenceNumber: sql<number>`coalesce(max(${dbSchema.billingSignal.sequenceNumber}), 0)`,
    })
    .from(dbSchema.billingSignal)
    .where(eq(dbSchema.billingSignal.billingAccountId, billingAccountId));

  return Number(rows[0]?.maxSequenceNumber ?? 0) + 1;
};

const areBillingSnapshotsEqual = (
  previousSnapshot: ReserveAppBillingObservationSnapshot,
  nextSnapshot: ReserveAppBillingObservationSnapshot,
) => {
  return (
    previousSnapshot.planCode === nextSnapshot.planCode &&
    previousSnapshot.planState === nextSnapshot.planState &&
    previousSnapshot.subscriptionStatus === nextSnapshot.subscriptionStatus &&
    previousSnapshot.paymentMethodStatus === nextSnapshot.paymentMethodStatus &&
    previousSnapshot.entitlementState === nextSnapshot.entitlementState &&
    previousSnapshot.paidTier?.code === nextSnapshot.paidTier?.code &&
    previousSnapshot.paidTier?.resolution === nextSnapshot.paidTier?.resolution &&
    previousSnapshot.paidTier?.diagnosticReason === nextSnapshot.paidTier?.diagnosticReason &&
    previousSnapshot.billingInterval === nextSnapshot.billingInterval &&
    previousSnapshot.stripeCustomerId === nextSnapshot.stripeCustomerId &&
    previousSnapshot.stripeSubscriptionId === nextSnapshot.stripeSubscriptionId &&
    previousSnapshot.stripePriceId === nextSnapshot.stripePriceId
  );
};

/**
 * audit/signal 比較用に、現在の billing aggregate と entitlement policy を同じ形へ正規化する。
 */
export const readReserveAppBillingObservationSnapshot = async ({
  database,
  env,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
}) => {
  const billing = await readReserveAppBillingV2Summary({ database, env, organizationId });
  const planCode: ReserveAppBillingPlanCode = billing?.planCode === 'premium' ? 'premium' : 'free';
  const billingInterval =
    billing?.billingInterval === 'month' || billing?.billingInterval === 'year'
      ? billing.billingInterval
      : null;
  const subscriptionStatus: ReserveAppBillingSubscriptionStatus =
    billing?.subscriptionStatus === 'trialing' ||
    billing?.subscriptionStatus === 'active' ||
    billing?.subscriptionStatus === 'past_due' ||
    billing?.subscriptionStatus === 'canceled' ||
    billing?.subscriptionStatus === 'unpaid' ||
    billing?.subscriptionStatus === 'incomplete'
      ? billing.subscriptionStatus
      : 'free';
  const paymentMethodStatus = await resolveReserveAppBillingPaymentMethodStatus({
    env,
    planCode,
    stripeCustomerId: billing?.stripeCustomerId ?? null,
  });
  const policy = resolveOrganizationPremiumEntitlementPolicy({
    planCode,
    subscriptionStatus,
    paymentMethodStatus,
    currentPeriodEnd:
      billing?.currentPeriodEnd instanceof Date ? billing.currentPeriodEnd.toISOString() : null,
    pastDueGraceEndsAt:
      billing?.pastDueGraceEndsAt instanceof Date ? billing.pastDueGraceEndsAt.toISOString() : null,
    cancelAtPeriodEnd: Boolean(billing?.cancelAtPeriodEnd),
    stripePriceId: billing?.stripePriceId ?? null,
    env,
  });

  return {
    planCode,
    planState: policy.planState,
    subscriptionStatus,
    paymentMethodStatus: policy.paymentMethodStatus,
    entitlementState: policy.entitlementState,
    paidTier: policy.paidTier,
    billingInterval,
    stripeCustomerId: billing?.stripeCustomerId ?? null,
    stripeSubscriptionId: billing?.stripeSubscriptionId ?? null,
    stripePriceId: billing?.stripePriceId ?? null,
  } satisfies ReserveAppBillingObservationSnapshot;
};

/**
 * billing state が実際に変わった場合だけ、sequence 付き audit event を追記する。
 */
export const appendReserveAppBillingAuditEvent = async ({
  database,
  organizationId,
  sourceKind,
  previousSnapshot,
  nextSnapshot,
  stripeEventId,
  sourceContext,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  sourceKind: ReserveAppBillingAuditSourceKind;
  previousSnapshot: ReserveAppBillingObservationSnapshot;
  nextSnapshot: ReserveAppBillingObservationSnapshot;
  stripeEventId?: string | null;
  sourceContext?: string | null;
}) => {
  if (areBillingSnapshotsEqual(previousSnapshot, nextSnapshot)) {
    return false;
  }

  const state = await ensureReserveAppBillingV2State({
    database,
    organizationId,
  });
  const providerCustomerId = nextSnapshot.stripeCustomerId ?? previousSnapshot.stripeCustomerId;
  const providerSubscriptionId =
    nextSnapshot.stripeSubscriptionId ?? previousSnapshot.stripeSubscriptionId;

  await retryBillingSequenceInsert({
    tableName: 'billing_audit_event',
    operation: async () => {
      const sequenceNumber = await selectNextBillingAuditSequenceNumber({
        database,
        billingAccountId: state.account.id,
      });

      await database.insert(dbSchema.billingAuditEvent).values({
        id: crypto.randomUUID(),
        billingAccountId: state.account.id,
        sequenceNumber,
        sourceKind,
        sourceContext: sourceContext ?? null,
        previousSnapshotJson: toSnapshotJson(previousSnapshot),
        nextSnapshotJson: toSnapshotJson(nextSnapshot),
        provider: providerCustomerId || providerSubscriptionId || stripeEventId ? 'stripe' : null,
        providerEventId: stripeEventId ?? null,
        providerCustomerId,
        providerSubscriptionId,
      });
    },
  });

  return true;
};

/** mismatch、通知失敗、profile 不備など、状態遷移とは別の調査 signal を追記する。 */
export const appendReserveAppBillingSignal = async ({
  database,
  organizationId,
  signalKind,
  signalStatus,
  sourceKind,
  reason,
  appSnapshot,
  stripeEventId,
  stripeCustomerId,
  stripeSubscriptionId,
  providerPlanState,
  providerSubscriptionStatus,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  signalKind: ReserveAppBillingSignalKind;
  signalStatus: ReserveAppBillingSignalStatus;
  sourceKind: string;
  reason: string;
  appSnapshot: ReserveAppBillingObservationSnapshot;
  stripeEventId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  providerPlanState?: ReserveAppBillingPlanState | null;
  providerSubscriptionStatus?: string | null;
}) => {
  const state = await ensureReserveAppBillingV2State({
    database,
    organizationId,
  });
  const providerCustomerId = stripeCustomerId ?? appSnapshot.stripeCustomerId;
  const providerSubscriptionId = stripeSubscriptionId ?? appSnapshot.stripeSubscriptionId;

  await retryBillingSequenceInsert({
    tableName: 'billing_signal',
    operation: async () => {
      const sequenceNumber = await selectNextBillingSignalSequenceNumber({
        database,
        billingAccountId: state.account.id,
      });

      await database.insert(dbSchema.billingSignal).values({
        id: crypto.randomUUID(),
        billingAccountId: state.account.id,
        sequenceNumber,
        signalKind,
        signalStatus,
        sourceKind,
        reason,
        appSnapshotJson: toSnapshotJson(appSnapshot),
        provider: providerCustomerId || providerSubscriptionId || stripeEventId ? 'stripe' : null,
        providerEventId: stripeEventId ?? null,
        providerCustomerId,
        providerSubscriptionId,
        providerPlanState: providerPlanState ?? null,
        providerSubscriptionStatus: providerSubscriptionStatus ?? null,
      });
    },
  });
};

/**
 * 直近の同種 signal が未解決の場合だけ resolved signal を追記し、調査 timeline を閉じる。
 */
export const appendResolvedReserveAppBillingSignalIfNeeded = async ({
  database,
  organizationId,
  signalKind,
  sourceKind,
  reason,
  appSnapshot,
  stripeEventId,
  stripeCustomerId,
  stripeSubscriptionId,
  providerPlanState,
  providerSubscriptionStatus,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  signalKind: ReserveAppBillingSignalKind;
  sourceKind: string;
  reason: string;
  appSnapshot: ReserveAppBillingObservationSnapshot;
  stripeEventId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  providerPlanState?: ReserveAppBillingPlanState | null;
  providerSubscriptionStatus?: string | null;
}) => {
  const state = await ensureReserveAppBillingV2State({
    database,
    organizationId,
  });
  const latestSignal = await database
    .select({
      signalStatus: dbSchema.billingSignal.signalStatus,
      signalKind: dbSchema.billingSignal.signalKind,
    })
    .from(dbSchema.billingSignal)
    .where(eq(dbSchema.billingSignal.billingAccountId, state.account.id))
    .orderBy(desc(dbSchema.billingSignal.sequenceNumber), desc(dbSchema.billingSignal.createdAt))
    .limit(20);

  const latestSameKind = latestSignal.find(
    (row: {
      signalKind: ReserveAppBillingSignalKind;
      signalStatus: ReserveAppBillingSignalStatus;
    }) => row.signalKind === signalKind,
  );
  if (
    !latestSameKind ||
    (latestSameKind.signalStatus !== 'pending' &&
      latestSameKind.signalStatus !== 'mismatch' &&
      latestSameKind.signalStatus !== 'unavailable')
  ) {
    return false;
  }

  await appendReserveAppBillingSignal({
    database,
    organizationId,
    signalKind,
    signalStatus: 'resolved',
    sourceKind,
    reason,
    appSnapshot,
    stripeEventId,
    stripeCustomerId,
    stripeSubscriptionId,
    providerPlanState,
    providerSubscriptionStatus,
  });
  return true;
};

/**
 * Stripe の最新 subscription とアプリ snapshot を比べ、reconciliation signal の理由を決める。
 */
export const evaluateReconciliationMismatchReason = ({
  appSnapshot,
  providerSubscription,
}: {
  appSnapshot: ReserveAppBillingObservationSnapshot;
  providerSubscription: StripeSubscriptionSummary;
}) => {
  const providerPlanState = resolveProviderPlanState(providerSubscription.status);
  if (!providerPlanState) {
    return {
      providerPlanState: null,
      reason: 'provider_subscription_status_unknown',
    };
  }

  if (appSnapshot.planState !== providerPlanState) {
    return {
      providerPlanState,
      reason: 'plan_state_mismatch',
    };
  }

  if (appSnapshot.subscriptionStatus !== providerSubscription.status) {
    return {
      providerPlanState,
      reason: 'subscription_status_mismatch',
    };
  }

  if (
    providerSubscription.customerId &&
    appSnapshot.stripeCustomerId &&
    providerSubscription.customerId !== appSnapshot.stripeCustomerId
  ) {
    return {
      providerPlanState,
      reason: 'stripe_customer_id_mismatch',
    };
  }

  if (
    providerPlanState !== 'free' &&
    providerSubscription.id !== appSnapshot.stripeSubscriptionId
  ) {
    return {
      providerPlanState,
      reason: 'stripe_subscription_id_mismatch',
    };
  }

  return {
    providerPlanState,
    reason: null,
  };
};

/** internal billing inspection 用に、reconciliation signal と webhook receipt/failure をまとめて返す。 */
export const readInternalBillingReconciliationInspection = async ({
  database,
  organizationId,
  stripeLinked,
  appSnapshot,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  stripeLinked: boolean;
  appSnapshot: Pick<
    ReserveAppBillingObservationSnapshot,
    'planState' | 'subscriptionStatus' | 'paymentMethodStatus' | 'entitlementState'
  >;
}) => {
  const [signalRows, webhookEventRows, webhookFailureRows] = await Promise.all([
    database
      .select({
        sequenceNumber: dbSchema.billingSignal.sequenceNumber,
        signalStatus: dbSchema.billingSignal.signalStatus,
        sourceKind: dbSchema.billingSignal.sourceKind,
        reason: dbSchema.billingSignal.reason,
        stripeEventId: dbSchema.billingSignal.providerEventId,
        providerPlanState: dbSchema.billingSignal.providerPlanState,
        providerSubscriptionStatus: dbSchema.billingSignal.providerSubscriptionStatus,
        appSnapshotJson: dbSchema.billingSignal.appSnapshotJson,
        createdAt: dbSchema.billingSignal.createdAt,
      })
      .from(dbSchema.billingSignal)
      .innerJoin(
        dbSchema.billingAccount,
        eq(dbSchema.billingSignal.billingAccountId, dbSchema.billingAccount.id),
      )
      .where(
        and(
          eq(dbSchema.billingAccount.subjectType, 'organization'),
          eq(dbSchema.billingAccount.subjectId, organizationId),
          eq(dbSchema.billingSignal.signalKind, 'reconciliation'),
        ),
      )
      .orderBy(desc(dbSchema.billingSignal.sequenceNumber), desc(dbSchema.billingSignal.createdAt))
      .limit(5),
    database
      .select({
        id: dbSchema.billingProviderEvent.providerEventId,
        eventType: dbSchema.billingProviderEvent.eventType,
        processingStatus: dbSchema.billingProviderEvent.processingStatus,
        failureReason: dbSchema.billingProviderEvent.failureReason,
        signatureVerificationStatus: sql<string>`'verified'`,
        duplicateDetected: dbSchema.billingProviderEvent.duplicateDetected,
        duplicateDetectedAt: dbSchema.billingProviderEvent.duplicateDetectedAt,
        receiptStatus: dbSchema.billingProviderEvent.receiptStatus,
        createdAt: dbSchema.billingProviderEvent.createdAt,
        processedAt: dbSchema.billingProviderEvent.processedAt,
      })
      .from(dbSchema.billingProviderEvent)
      .innerJoin(
        dbSchema.billingAccount,
        eq(dbSchema.billingProviderEvent.billingAccountId, dbSchema.billingAccount.id),
      )
      .where(
        and(
          eq(dbSchema.billingAccount.subjectType, 'organization'),
          eq(dbSchema.billingAccount.subjectId, organizationId),
          eq(dbSchema.billingProviderEvent.provider, 'stripe'),
          eq(dbSchema.billingProviderEvent.scope, 'billing'),
        ),
      )
      .orderBy(desc(dbSchema.billingProviderEvent.createdAt))
      .limit(5),
    database
      .select({
        eventId: dbSchema.billingProviderEvent.providerEventId,
        eventType: dbSchema.billingProviderEvent.eventType,
        failureStage: dbSchema.billingProviderEvent.failureStage,
        failureReason: dbSchema.billingProviderEvent.lastFailureReason,
        createdAt: dbSchema.billingProviderEvent.lastFailureAt,
      })
      .from(dbSchema.billingProviderEvent)
      .innerJoin(
        dbSchema.billingAccount,
        eq(dbSchema.billingProviderEvent.billingAccountId, dbSchema.billingAccount.id),
      )
      .where(
        and(
          eq(dbSchema.billingAccount.subjectType, 'organization'),
          eq(dbSchema.billingAccount.subjectId, organizationId),
          eq(dbSchema.billingProviderEvent.provider, 'stripe'),
          eq(dbSchema.billingProviderEvent.scope, 'billing'),
          isNotNull(dbSchema.billingProviderEvent.failureStage),
        ),
      )
      .orderBy(desc(dbSchema.billingProviderEvent.lastFailureAt))
      .limit(5),
  ]);

  const recentSignals = signalRows
    .reverse()
    .map((row: (typeof signalRows)[number]): InternalBillingReconciliationSignalEntry => {
      const appSnapshot = parseSnapshotJson(row.appSnapshotJson);
      return {
        sequenceNumber: row.sequenceNumber,
        signalStatus: row.signalStatus as ReserveAppBillingSignalStatus,
        sourceKind: row.sourceKind,
        reason: row.reason,
        stripeEventId: row.stripeEventId ?? null,
        providerPlanState: normalizeSignalProviderPlanState(row.providerPlanState),
        providerSubscriptionStatus: normalizeSignalProviderSubscriptionStatus(
          row.providerSubscriptionStatus,
        ),
        appPlanState: normalizeSignalAppPlanState(appSnapshot.planState),
        appSubscriptionStatus: normalizeSignalAppSubscriptionStatus(appSnapshot.subscriptionStatus),
        appPaymentMethodStatus: normalizeSignalAppPaymentMethodStatus(
          appSnapshot.paymentMethodStatus,
        ),
        appEntitlementState: normalizeSignalAppEntitlementState(appSnapshot.entitlementState),
        createdAt: toIsoDateString(row.createdAt),
      };
    });

  const recentWebhookEvents = webhookEventRows.reverse().map(
    (row: (typeof webhookEventRows)[number]): InternalBillingReconciliationWebhookEventEntry => ({
      id: row.id,
      eventType: row.eventType,
      processingStatus: row.processingStatus as 'processing' | 'processed' | 'failed',
      failureReason: row.failureReason ?? null,
      signatureVerificationStatus: row.signatureVerificationStatus,
      duplicateDetected: Boolean(row.duplicateDetected),
      duplicateDetectedAt: toIsoDateString(row.duplicateDetectedAt),
      receiptStatus: row.receiptStatus,
      createdAt: toIsoDateString(row.createdAt),
      processedAt: toIsoDateString(row.processedAt),
    }),
  );

  const recentWebhookFailures = webhookFailureRows.reverse().map(
    (
      row: (typeof webhookFailureRows)[number],
    ): InternalBillingReconciliationWebhookFailureEntry => ({
      eventId:
        row.eventId.startsWith('stripe_billing_failure:') ||
        row.eventId.startsWith('legacy_failure:')
          ? null
          : row.eventId,
      eventType: row.eventType ?? null,
      failureStage: row.failureStage ?? 'event_processing',
      failureReason: row.failureReason ?? 'unknown_failure',
      createdAt: toIsoDateString(row.createdAt),
    }),
  );

  const latestSignal = recentSignals.at(-1) ?? null;
  const fallbackAppPaymentMethodStatus =
    stripeLinked &&
    appSnapshot.planState === 'premium_paid' &&
    (appSnapshot.subscriptionStatus === 'active' ||
      appSnapshot.subscriptionStatus === 'past_due' ||
      appSnapshot.subscriptionStatus === 'unpaid' ||
      appSnapshot.subscriptionStatus === 'incomplete')
      ? 'registered'
      : appSnapshot.paymentMethodStatus;
  const currentComparison = latestSignal
    ? {
        providerPlanState: latestSignal.providerPlanState,
        providerSubscriptionStatus: latestSignal.providerSubscriptionStatus,
        appPlanState: latestSignal.appPlanState,
        appSubscriptionStatus: latestSignal.appSubscriptionStatus,
        appPaymentMethodStatus: latestSignal.appPaymentMethodStatus,
        appEntitlementState: latestSignal.appEntitlementState,
      }
    : {
        providerPlanState: null,
        providerSubscriptionStatus: null,
        appPlanState: appSnapshot.planState,
        appSubscriptionStatus: appSnapshot.subscriptionStatus,
        appPaymentMethodStatus: fallbackAppPaymentMethodStatus,
        appEntitlementState: appSnapshot.entitlementState,
      };

  const comparable =
    currentComparison.providerPlanState !== null &&
    currentComparison.providerSubscriptionStatus !== null;

  let status: InternalBillingReconciliationStatus;
  if (!stripeLinked) {
    status = 'not_applicable';
  } else if (!latestSignal) {
    status = 'incomplete';
  } else if (latestSignal.signalStatus === 'unavailable') {
    status = 'unavailable';
  } else if (!comparable) {
    status = 'incomplete';
  } else if (latestSignal.signalStatus === 'resolved') {
    status = 'aligned';
  } else if (latestSignal.signalStatus === 'mismatch') {
    status = 'mismatch';
  } else {
    status = 'pending';
  }

  return {
    status,
    comparable,
    latestSignalStatus: latestSignal?.signalStatus ?? null,
    latestSignalReason: latestSignal?.reason ?? null,
    currentComparison,
    recentSignals,
    recentWebhookEvents,
    recentWebhookFailures,
  } satisfies InternalBillingReconciliationInspection;
};
