import type { BillingPaymentIssue, BillingSubscription } from '@repo/saas-billing-core';
import { and, count, desc, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import {
  RESERVE_APP_BILLING_PAST_DUE_GRACE_DAYS,
  RESERVE_APP_PREMIUM_TRIAL_COMPLETION_CONFLICT_MESSAGE,
  RESERVE_APP_PREMIUM_TRIAL_COMPLETION_NOT_READY_MESSAGE,
  RESERVE_APP_PREMIUM_TRIAL_COMPLETION_PENDING_MESSAGE,
  RESERVE_APP_PREMIUM_TRIAL_DURATION_DAYS,
  projectReserveAppEntitlements,
  reserveAppBillingSubject,
  resolveReserveAppBillingIntervalFromPriceId,
  resolveReserveAppBillingPaymentMethodEvaluation,
  type ReserveAppBillingPaymentIssueState,
  type ReserveAppBillingPlanCode,
  type ReserveAppBillingSubscriptionStatus,
} from '../../features/billing/policies/reserve-app-billing-policy.js';
import type { OrganizationBillingInvoicePaymentEventType } from '../../domain/billing/organization-billing-invoice-events.js';
import * as dbSchema from '../db/schema.js';
import { readStripeSubscriptionSummaryById } from '../payment/stripe.js';
import { createDrizzleBillingStore } from './drizzle-billing-store.js';

type ReserveAppBillingV2State = {
  billingStore: ReturnType<typeof createDrizzleBillingStore>;
  account: Awaited<ReturnType<ReturnType<typeof createDrizzleBillingStore>['ensureAccount']>>;
  subscription: BillingSubscription;
  paymentIssue: BillingPaymentIssue;
};

const normalizeSubscriptionStatus = (
  value: string | null | undefined,
): ReserveAppBillingSubscriptionStatus => {
  if (
    value === 'trialing' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'canceled' ||
    value === 'unpaid' ||
    value === 'incomplete'
  ) {
    return value;
  }
  return 'free';
};

const resolvePlanCode = (value: string | null | undefined): ReserveAppBillingPlanCode =>
  value === 'premium' ? 'premium' : 'free';

const resolveBillingInterval = (value: string | null | undefined): 'month' | 'year' | null =>
  value === 'month' || value === 'year' ? value : null;

const resolvePaymentIssueState = ({
  subscriptionStatus,
  pastDueGraceEndsAt,
  now,
}: {
  subscriptionStatus: ReserveAppBillingSubscriptionStatus;
  pastDueGraceEndsAt?: Date | null;
  now: Date;
}): ReserveAppBillingPaymentIssueState => {
  if (subscriptionStatus === 'past_due') {
    return pastDueGraceEndsAt && pastDueGraceEndsAt.getTime() > now.getTime()
      ? 'past_due_grace_active'
      : 'past_due_grace_expired';
  }
  if (subscriptionStatus === 'unpaid') {
    return 'unpaid';
  }
  if (subscriptionStatus === 'incomplete') {
    return 'incomplete';
  }
  return 'none';
};

const isCurrentPaymentIssueState = (state: ReserveAppBillingPaymentIssueState) =>
  state !== 'none' && state !== 'recovered' && state !== 'stale_failure_history_only';

const currentPaymentIssueStartedAt = (paymentIssue: BillingPaymentIssue) =>
  isCurrentPaymentIssueState(paymentIssue.state) ? paymentIssue.issueStartedAt : null;

const currentPastDueGraceEndsAt = (paymentIssue: BillingPaymentIssue) =>
  paymentIssue.state === 'past_due_grace_active' || paymentIssue.state === 'past_due_grace_expired'
    ? paymentIssue.pastDueGraceEndsAt
    : null;

const isUnknownPremiumPrice = ({
  env,
  planCode,
  stripePriceId,
}: {
  env: AuthRuntimeEnv;
  planCode: ReserveAppBillingPlanCode;
  stripePriceId?: string | null;
}) => {
  if (planCode !== 'premium') {
    return false;
  }
  const normalizedPriceId = stripePriceId?.trim() ?? '';
  if (!normalizedPriceId) {
    return false;
  }
  return (
    normalizedPriceId !== env.STRIPE_PREMIUM_MONTHLY_PRICE_ID?.trim() &&
    normalizedPriceId !== env.STRIPE_PREMIUM_YEARLY_PRICE_ID?.trim()
  );
};

const resolvePaymentIssueFields = ({
  subscriptionStatus,
  existingPaymentIssue,
  providerPaymentIssueStartedAt,
  explicitPastDueGraceEndsAt,
  now,
}: {
  subscriptionStatus: ReserveAppBillingSubscriptionStatus;
  existingPaymentIssue: BillingPaymentIssue | null;
  providerPaymentIssueStartedAt?: Date | null;
  explicitPastDueGraceEndsAt?: Date | null;
  now: Date;
}) => {
  const providerIssueTime = providerPaymentIssueStartedAt?.getTime() ?? null;
  const existingIssueTime = existingPaymentIssue?.issueStartedAt?.getTime() ?? null;
  const paymentIssueStartedAt =
    providerPaymentIssueStartedAt &&
    (existingIssueTime === null || providerIssueTime! <= existingIssueTime)
      ? providerPaymentIssueStartedAt
      : (existingPaymentIssue?.issueStartedAt ?? providerPaymentIssueStartedAt ?? now);

  if (subscriptionStatus === 'past_due') {
    const canKeepExistingGrace =
      existingPaymentIssue?.pastDueGraceEndsAt &&
      existingIssueTime !== null &&
      paymentIssueStartedAt.getTime() === existingIssueTime;
    const pastDueGraceEndsAt =
      explicitPastDueGraceEndsAt !== undefined
        ? explicitPastDueGraceEndsAt
        : ((canKeepExistingGrace ? existingPaymentIssue.pastDueGraceEndsAt : null) ??
          new Date(
            paymentIssueStartedAt.getTime() +
              RESERVE_APP_BILLING_PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000,
          ));

    return {
      paymentIssueStartedAt,
      pastDueGraceEndsAt,
      issueStartedAtSource:
        providerPaymentIssueStartedAt &&
        paymentIssueStartedAt.getTime() === providerPaymentIssueStartedAt.getTime()
          ? 'provider_issue_time'
          : 'application_receipt_time',
    } as const;
  }

  if (subscriptionStatus === 'incomplete' || subscriptionStatus === 'unpaid') {
    return {
      paymentIssueStartedAt,
      pastDueGraceEndsAt: null,
      issueStartedAtSource:
        providerPaymentIssueStartedAt &&
        paymentIssueStartedAt.getTime() === providerPaymentIssueStartedAt.getTime()
          ? 'provider_issue_time'
          : 'application_receipt_time',
    } as const;
  }

  return {
    paymentIssueStartedAt: null,
    pastDueGraceEndsAt: null,
    issueStartedAtSource: 'none',
  } as const;
};

export const ensureReserveAppBillingV2State = async ({
  database,
  organizationId,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  now?: Date;
}): Promise<ReserveAppBillingV2State> => {
  const billingStore = createDrizzleBillingStore({ database });
  const subject = reserveAppBillingSubject(organizationId);
  const account = await billingStore.ensureAccount({
    ...subject,
    provider: 'stripe',
  });

  let subscription = await billingStore.findCurrentSubscription({
    billingAccountId: account.id,
  });
  if (!subscription) {
    subscription = await billingStore.upsertSubscription({
      billingAccountId: account.id,
      provider: 'stripe',
      providerSubscriptionId: null,
      planCode: 'free',
      priceCode: null,
      interval: null,
      status: 'free',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      trialStart: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
    });
  }

  let paymentIssue = await billingStore.readPaymentIssue({
    billingAccountId: account.id,
  });
  if (!paymentIssue) {
    await billingStore.upsertPaymentIssue({
      billingAccountId: account.id,
      billingSubscriptionId: subscription.id,
      state: 'none',
      issueStartedAt: null,
      issueStartedAtSource: 'none',
      pastDueGraceEndsAt: null,
      latestProviderEventId: null,
      latestInvoiceId: null,
      latestPaymentIntentId: null,
    });
    paymentIssue = await billingStore.readPaymentIssue({
      billingAccountId: account.id,
    });
  }

  if (!paymentIssue) {
    throw new Error('BILLING_PAYMENT_ISSUE_ENSURE_FAILED');
  }

  return {
    billingStore,
    account,
    subscription,
    paymentIssue,
  };
};

export const syncReserveAppBillingV2DerivedState = async ({
  database,
  env,
  organizationId,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  now?: Date;
  trialEndedAt?: Date | null;
}) => {
  const state = await ensureReserveAppBillingV2State({
    database,
    organizationId,
    now,
  });
  const planCode = resolvePlanCode(state.subscription.planCode);
  const subscriptionStatus = normalizeSubscriptionStatus(state.subscription.status);

  await state.billingStore.replaceEntitlements({
    billingAccountId: state.account.id,
    entitlements: projectReserveAppEntitlements({
      planCode,
      subscriptionStatus,
      trialEnd: state.subscription.trialEnd,
      currentPeriodEnd: state.subscription.currentPeriodEnd,
      paymentIssue: {
        state: state.paymentIssue.state,
        pastDueGraceEndsAt: state.paymentIssue.pastDueGraceEndsAt,
      },
      unknownPrice: isUnknownPremiumPrice({
        env,
        planCode,
        stripePriceId: state.subscription.priceCode,
      }),
      now,
    }),
  });
  return {
    account: state.account,
    subscription: state.subscription,
    paymentIssue: state.paymentIssue,
    paymentIssueState: state.paymentIssue.state,
  };
};

export const updateReserveAppBillingV2CustomerId = async ({
  database,
  env,
  organizationId,
  stripeCustomerId,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  stripeCustomerId: string;
  now?: Date;
}) => {
  const state = await ensureReserveAppBillingV2State({ database, organizationId, now });
  await state.billingStore.updateProviderCustomerId({
    billingAccountId: state.account.id,
    providerCustomerId: stripeCustomerId,
  });
  await syncReserveAppBillingV2DerivedState({ database, env, organizationId, now });
};

export const startReserveAppBillingV2PremiumTrial = async ({
  database,
  env,
  organizationId,
  now = new Date(),
  trialStartedAt = now,
  trialEndsAt = new Date(
    trialStartedAt.getTime() + RESERVE_APP_PREMIUM_TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000,
  ),
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripePriceId = null,
  billingInterval = null,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  now?: Date;
  trialStartedAt?: Date;
  trialEndsAt?: Date;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  billingInterval?: 'month' | 'year' | null;
}) => {
  const state = await ensureReserveAppBillingV2State({ database, organizationId, now });
  if (stripeCustomerId) {
    await state.billingStore.updateProviderCustomerId({
      billingAccountId: state.account.id,
      providerCustomerId: stripeCustomerId,
    });
  }
  const subscription = await state.billingStore.upsertSubscription({
    billingAccountId: state.account.id,
    provider: 'stripe',
    providerSubscriptionId: stripeSubscriptionId,
    planCode: 'premium',
    priceCode: stripePriceId,
    interval: billingInterval,
    status: 'trialing',
    currentPeriodStart: trialStartedAt,
    currentPeriodEnd: trialEndsAt,
    trialStart: trialStartedAt,
    trialEnd: trialEndsAt,
    cancelAtPeriodEnd: false,
  });
  await state.billingStore.upsertPaymentIssue({
    billingAccountId: state.account.id,
    billingSubscriptionId: subscription.id,
    state: 'none',
    issueStartedAt: null,
    issueStartedAtSource: 'none',
    pastDueGraceEndsAt: null,
    latestProviderEventId: null,
    latestInvoiceId: null,
    latestPaymentIntentId: null,
  });
  await syncReserveAppBillingV2DerivedState({
    database,
    env,
    organizationId,
    now,
    trialEndedAt: null,
  });

  return {
    trialStartedAt,
    trialEndsAt,
  };
};

export const upsertReserveAppBillingV2SubscriptionState = async ({
  database,
  env,
  organizationId,
  planCode,
  stripeCustomerId,
  stripeSubscriptionId,
  stripePriceId,
  billingInterval,
  subscriptionStatus,
  cancelAtPeriodEnd = false,
  currentPeriodStart = null,
  currentPeriodEnd = null,
  paymentIssueOccurredAt = null,
  pastDueGraceEndsAt,
  now = new Date(),
  trialStartedAt,
  trialEndedAt,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  planCode: ReserveAppBillingPlanCode;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  billingInterval?: 'month' | 'year' | null;
  subscriptionStatus: ReserveAppBillingSubscriptionStatus;
  cancelAtPeriodEnd?: boolean;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  paymentIssueOccurredAt?: Date | null;
  pastDueGraceEndsAt?: Date | null;
  now?: Date;
  trialStartedAt?: Date | null;
  trialEndedAt?: Date | null;
}) => {
  const state = await ensureReserveAppBillingV2State({ database, organizationId, now });
  if (stripeCustomerId && stripeCustomerId !== state.account.providerCustomerId) {
    await state.billingStore.updateProviderCustomerId({
      billingAccountId: state.account.id,
      providerCustomerId: stripeCustomerId,
    });
  }
  const paymentIssueFields = resolvePaymentIssueFields({
    subscriptionStatus,
    existingPaymentIssue: state.paymentIssue,
    providerPaymentIssueStartedAt: paymentIssueOccurredAt,
    explicitPastDueGraceEndsAt: pastDueGraceEndsAt,
    now,
  });
  const resolvedTrialStart =
    trialStartedAt ??
    (subscriptionStatus === 'trialing'
      ? (currentPeriodStart ?? state.subscription.trialStart ?? now)
      : state.subscription.trialStart);
  const resolvedTrialEnd =
    subscriptionStatus === 'trialing'
      ? (currentPeriodEnd ?? state.subscription.trialEnd)
      : trialEndedAt !== undefined
        ? trialEndedAt
        : state.subscription.trialEnd;
  const subscription = await state.billingStore.upsertSubscription({
    billingAccountId: state.account.id,
    provider: 'stripe',
    providerSubscriptionId: stripeSubscriptionId ?? null,
    planCode,
    priceCode: stripePriceId ?? null,
    interval: billingInterval ?? null,
    status: subscriptionStatus,
    currentPeriodStart,
    currentPeriodEnd,
    trialStart: resolvedTrialStart,
    trialEnd: resolvedTrialEnd,
    cancelAtPeriodEnd,
  });
  const paymentIssueState = resolvePaymentIssueState({
    subscriptionStatus,
    pastDueGraceEndsAt: paymentIssueFields.pastDueGraceEndsAt,
    now,
  });
  await state.billingStore.upsertPaymentIssue({
    billingAccountId: state.account.id,
    billingSubscriptionId: subscription.id,
    state: paymentIssueState,
    issueStartedAt: paymentIssueFields.paymentIssueStartedAt,
    issueStartedAtSource: paymentIssueFields.issueStartedAtSource,
    pastDueGraceEndsAt: paymentIssueFields.pastDueGraceEndsAt,
    latestProviderEventId: null,
    latestInvoiceId: null,
    latestPaymentIntentId: null,
  });

  return syncReserveAppBillingV2DerivedState({
    database,
    env,
    organizationId,
    now,
    trialEndedAt,
  });
};

export const applyReserveAppBillingV2TrialCompletion = async ({
  database,
  env,
  organizationId,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  now?: Date;
}): Promise<
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      status: 409 | 422 | 503;
      message: string;
    }
> => {
  const billing = await readReserveAppBillingV2Summary({ database, env, organizationId });
  if (billing?.planCode !== 'premium' || billing.subscriptionStatus !== 'trialing') {
    return {
      ok: false,
      status: 409,
      message: RESERVE_APP_PREMIUM_TRIAL_COMPLETION_CONFLICT_MESSAGE,
    };
  }

  const trialEndsAt = billing.currentPeriodEnd instanceof Date ? billing.currentPeriodEnd : null;
  if (!trialEndsAt || trialEndsAt.getTime() > now.getTime()) {
    return {
      ok: false,
      status: 409,
      message: RESERVE_APP_PREMIUM_TRIAL_COMPLETION_NOT_READY_MESSAGE,
    };
  }

  const paymentMethod = await resolveReserveAppBillingPaymentMethodEvaluation({
    env,
    planCode: 'premium',
    stripeCustomerId: billing.stripeCustomerId ?? null,
  });

  if (billing.stripeSubscriptionId && env.STRIPE_SECRET_KEY?.trim()) {
    try {
      const latestSubscription = await readStripeSubscriptionSummaryById({
        env,
        subscriptionId: billing.stripeSubscriptionId,
      });
      const latestSubscriptionStatus = normalizeSubscriptionStatus(latestSubscription.status);
      if (latestSubscriptionStatus !== 'trialing' && latestSubscriptionStatus !== 'free') {
        const isCanceled = latestSubscriptionStatus === 'canceled';
        await upsertReserveAppBillingV2SubscriptionState({
          database,
          env,
          organizationId,
          planCode: isCanceled ? 'free' : 'premium',
          stripeCustomerId: latestSubscription.customerId,
          stripeSubscriptionId: isCanceled ? null : latestSubscription.id,
          stripePriceId: isCanceled ? null : latestSubscription.priceId,
          billingInterval: isCanceled
            ? null
            : resolveReserveAppBillingIntervalFromPriceId(env, latestSubscription.priceId),
          subscriptionStatus: isCanceled ? 'free' : latestSubscriptionStatus,
          cancelAtPeriodEnd: isCanceled ? false : latestSubscription.cancelAtPeriodEnd,
          currentPeriodStart: isCanceled ? null : latestSubscription.currentPeriodStart,
          currentPeriodEnd: isCanceled ? null : latestSubscription.currentPeriodEnd,
          now,
          trialEndedAt: now,
        });

        return {
          ok: true,
          message: isCanceled
            ? 'Organization premium trial ended and returned to free because billing requirements were not met.'
            : 'Organization premium trial converted to premium paid.',
        };
      }
    } catch {
      return {
        ok: false,
        status: 503,
        message: RESERVE_APP_PREMIUM_TRIAL_COMPLETION_PENDING_MESSAGE,
      };
    }

    return {
      ok: false,
      status: 503,
      message: RESERVE_APP_PREMIUM_TRIAL_COMPLETION_PENDING_MESSAGE,
    };
  }

  if (paymentMethod.reason === 'default_payment_method_registered') {
    await upsertReserveAppBillingV2SubscriptionState({
      database,
      env,
      organizationId,
      planCode: 'premium',
      stripeCustomerId: billing.stripeCustomerId ?? null,
      stripeSubscriptionId: billing.stripeSubscriptionId ?? null,
      stripePriceId: billing.stripePriceId ?? null,
      billingInterval: resolveBillingInterval(billing.billingInterval),
      subscriptionStatus: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodStart: now,
      currentPeriodEnd: null,
      now,
      trialEndedAt: now,
    });

    return {
      ok: true,
      message: 'Organization premium trial converted to premium paid.',
    };
  }

  if (
    paymentMethod.reason === 'missing_customer' ||
    paymentMethod.reason === 'missing_default_payment_method'
  ) {
    await upsertReserveAppBillingV2SubscriptionState({
      database,
      env,
      organizationId,
      planCode: 'free',
      stripeCustomerId: billing.stripeCustomerId ?? null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      billingInterval: null,
      subscriptionStatus: 'free',
      cancelAtPeriodEnd: false,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      now,
      trialEndedAt: now,
    });

    return {
      ok: true,
      message:
        'Organization premium trial ended and returned to free because billing requirements were not met.',
    };
  }

  return paymentMethod.reason === 'stripe_not_configured'
    ? {
        ok: false,
        status: 422,
        message: 'Stripe billing is not configured.',
      }
    : {
        ok: false,
        status: 503,
        message: RESERVE_APP_PREMIUM_TRIAL_COMPLETION_PENDING_MESSAGE,
      };
};

export const hasReserveAppBillingV2StartedPremiumTrial = async ({
  database,
  env,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
}) => {
  const projection = await syncReserveAppBillingV2DerivedState({ database, env, organizationId });
  if (projection.subscription.trialStart) {
    return true;
  }

  const auditRows = await database
    .select({ count: count() })
    .from(dbSchema.billingAuditEvent)
    .innerJoin(
      dbSchema.billingAccount,
      eq(dbSchema.billingAuditEvent.billingAccountId, dbSchema.billingAccount.id),
    )
    .where(
      and(
        eq(dbSchema.billingAccount.subjectType, 'organization'),
        eq(dbSchema.billingAccount.subjectId, organizationId),
        eq(dbSchema.billingAuditEvent.sourceKind, 'trial_start'),
      ),
    );

  return Number(auditRows[0]?.count ?? 0) > 0;
};

export const findReserveAppBillingV2ByStripeIdentifiers = async ({
  database,
  stripeCustomerId,
  stripeSubscriptionId,
}: {
  database: AuthRuntimeDatabase;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}) => {
  if (stripeSubscriptionId) {
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
          eq(dbSchema.billingSubscription.provider, 'stripe'),
          eq(dbSchema.billingSubscription.providerSubscriptionId, stripeSubscriptionId),
          eq(dbSchema.billingAccount.subjectType, 'organization'),
        ),
      )
      .limit(1);
    if (rows[0]) {
      return rows[0];
    }
  }

  if (stripeCustomerId) {
    const rows = await database
      .select({
        organizationId: dbSchema.billingAccount.subjectId,
      })
      .from(dbSchema.billingAccount)
      .where(
        and(
          eq(dbSchema.billingAccount.provider, 'stripe'),
          eq(dbSchema.billingAccount.providerCustomerId, stripeCustomerId),
          eq(dbSchema.billingAccount.subjectType, 'organization'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  return null;
};

const resolveIssueEventState = ({
  invoiceEventType,
  projectedPaymentIssueState,
  stalePaymentIssueAfterRecovery,
}: {
  invoiceEventType: OrganizationBillingInvoicePaymentEventType;
  projectedPaymentIssueState: ReserveAppBillingPaymentIssueState;
  stalePaymentIssueAfterRecovery?: boolean;
}): ReserveAppBillingPaymentIssueState | null => {
  if (stalePaymentIssueAfterRecovery) {
    return 'stale_failure_history_only';
  }

  if (invoiceEventType === 'payment_succeeded') {
    return 'recovered';
  }

  if (invoiceEventType === 'payment_action_required') {
    return projectedPaymentIssueState === 'past_due_grace_active' ||
      projectedPaymentIssueState === 'past_due_grace_expired' ||
      projectedPaymentIssueState === 'unpaid' ||
      projectedPaymentIssueState === 'incomplete'
      ? projectedPaymentIssueState
      : 'payment_action_required';
  }

  if (invoiceEventType === 'payment_failed') {
    return projectedPaymentIssueState === 'past_due_grace_active' ||
      projectedPaymentIssueState === 'past_due_grace_expired' ||
      projectedPaymentIssueState === 'unpaid' ||
      projectedPaymentIssueState === 'incomplete'
      ? projectedPaymentIssueState
      : 'payment_failed';
  }

  return null;
};

export const appendReserveAppBillingV2PaymentIssueEvent = async ({
  database,
  env,
  organizationId,
  invoiceEventType,
  providerEventId,
  providerInvoiceId,
  providerPaymentIntentId,
  occurredAt,
  stalePaymentIssueAfterRecovery = false,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  invoiceEventType: OrganizationBillingInvoicePaymentEventType;
  providerEventId: string;
  providerInvoiceId?: string | null;
  providerPaymentIntentId?: string | null;
  occurredAt?: Date | null;
  stalePaymentIssueAfterRecovery?: boolean;
}) => {
  const projection = await syncReserveAppBillingV2DerivedState({
    database,
    env,
    organizationId,
  });
  const state = resolveIssueEventState({
    invoiceEventType,
    projectedPaymentIssueState: projection.paymentIssueState,
    stalePaymentIssueAfterRecovery,
  });

  if (!state) {
    return projection;
  }

  const billingStore = createDrizzleBillingStore({ database });
  const currentIssue = await billingStore.readPaymentIssue({
    billingAccountId: projection.account.id,
  });
  const shouldStartNewIssue = state === 'payment_failed' || state === 'payment_action_required';
  const currentStateAllowsNewIssueStart =
    !currentIssue ||
    currentIssue.state === 'none' ||
    currentIssue.state === 'recovered' ||
    currentIssue.state === 'stale_failure_history_only';
  const issueStartedAt =
    shouldStartNewIssue && currentStateAllowsNewIssueStart
      ? (occurredAt ?? null)
      : (currentIssue?.issueStartedAt ?? occurredAt ?? null);
  await billingStore.upsertPaymentIssue({
    billingAccountId: projection.account.id,
    billingSubscriptionId: projection.subscription.id,
    state,
    issueStartedAt,
    issueStartedAtSource:
      shouldStartNewIssue && currentStateAllowsNewIssueStart
        ? occurredAt
          ? 'provider_issue_time'
          : 'application_receipt_time'
        : (currentIssue?.issueStartedAtSource ??
          (occurredAt ? 'provider_issue_time' : 'application_receipt_time')),
    pastDueGraceEndsAt: currentIssue?.pastDueGraceEndsAt ?? null,
    latestProviderEventId: providerEventId,
    latestInvoiceId: providerInvoiceId ?? null,
    latestPaymentIntentId: providerPaymentIntentId ?? null,
  });
  await billingStore.appendPaymentIssueEvent({
    billingAccountId: projection.account.id,
    billingSubscriptionId: projection.subscription.id,
    eventType: stalePaymentIssueAfterRecovery ? 'stale_failure' : invoiceEventType,
    provider: 'stripe',
    providerEventId,
    providerInvoiceId: providerInvoiceId ?? null,
    providerPaymentIntentId: providerPaymentIntentId ?? null,
    occurredAt: occurredAt ?? null,
  });

  return syncReserveAppBillingV2DerivedState({ database, env, organizationId });
};

export const readReserveAppBillingV2Summary = async ({
  database,
  env,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
}) => {
  const projection = await syncReserveAppBillingV2DerivedState({
    database,
    env,
    organizationId,
  });
  const planCode = resolvePlanCode(projection.subscription.planCode);
  const subscriptionStatus = normalizeSubscriptionStatus(projection.subscription.status);
  const inferredTrialEndedAt =
    projection.subscription.trialStart && subscriptionStatus !== 'trialing'
      ? projection.subscription.trialEnd
      : null;
  const latestReconciliationRows = await database
    .select({
      lastReconciledAt: dbSchema.billingSignal.createdAt,
      lastReconciliationReason: dbSchema.billingSignal.sourceKind,
    })
    .from(dbSchema.billingSignal)
    .where(
      and(
        eq(dbSchema.billingSignal.billingAccountId, projection.account.id),
        eq(dbSchema.billingSignal.signalKind, 'reconciliation'),
      ),
    )
    .orderBy(desc(dbSchema.billingSignal.sequenceNumber), desc(dbSchema.billingSignal.createdAt))
    .limit(1);
  const latestReconciliation = latestReconciliationRows[0] ?? null;

  return {
    planCode,
    billingInterval: resolveBillingInterval(projection.subscription.interval),
    subscriptionStatus,
    cancelAtPeriodEnd: projection.subscription.cancelAtPeriodEnd,
    trialStartedAt: projection.subscription.trialStart,
    trialEndedAt: inferredTrialEndedAt,
    currentPeriodStart: projection.subscription.currentPeriodStart,
    currentPeriodEnd: projection.subscription.currentPeriodEnd,
    paymentIssueStartedAt: currentPaymentIssueStartedAt(projection.paymentIssue),
    pastDueGraceEndsAt: currentPastDueGraceEndsAt(projection.paymentIssue),
    billingProfileReadiness: 'not_required',
    billingProfileNextAction: null,
    billingProfileCheckedAt: null,
    lastReconciledAt: latestReconciliation?.lastReconciledAt ?? null,
    lastReconciliationReason: latestReconciliation?.lastReconciliationReason ?? null,
    stripeCustomerId: projection.account.providerCustomerId,
    stripeSubscriptionId: projection.subscription.providerSubscriptionId,
    stripePriceId: projection.subscription.priceCode,
  };
};
