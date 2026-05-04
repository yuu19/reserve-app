import { and, count, eq, or, sql, type SQL } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import { readStripeCustomerSummary, readStripeSubscriptionSummaryById } from '../payment/stripe.js';
import {
  buildBillingProfileReadiness,
  type OrganizationBillingProfileReadiness,
} from './organization-billing-profile.js';

export const ORGANIZATION_PREMIUM_TRIAL_DURATION_DAYS = 7;
export const ORGANIZATION_BILLING_PAST_DUE_GRACE_DAYS = 7;
export const ORGANIZATION_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE =
  'Organization already has an active premium trial or paid subscription.';
export const ORGANIZATION_PREMIUM_TRIAL_COMPLETION_CONFLICT_MESSAGE =
  'Organization does not have an active premium trial.';
export const ORGANIZATION_PREMIUM_TRIAL_COMPLETION_NOT_READY_MESSAGE =
  'Organization premium trial has not reached its completion time yet.';
export const ORGANIZATION_PREMIUM_TRIAL_COMPLETION_PENDING_MESSAGE =
  'Payment method status is still syncing with Stripe. Retry after billing synchronization completes.';

export type OrganizationBillingPlanCode = 'free' | 'premium';
export type OrganizationBillingSubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';
export type OrganizationBillingPlanState = 'free' | 'premium_trial' | 'premium_paid';
export type OrganizationBillingPaymentMethodStatus = 'not_started' | 'pending' | 'registered';
export type OrganizationBillingPaymentMethodReason =
  | 'plan_is_free'
  | 'missing_customer'
  | 'missing_default_payment_method'
  | 'default_payment_method_registered'
  | 'stripe_not_configured'
  | 'stripe_lookup_failed';

export type OrganizationBillingPaymentMethodEvaluation = {
  status: OrganizationBillingPaymentMethodStatus;
  reason: OrganizationBillingPaymentMethodReason;
};

export type OrganizationBillingActionAvailability = {
  canStartTrial: boolean;
  canStartPaidCheckout: boolean;
  canRegisterPaymentMethod: boolean;
  canOpenBillingPortal: boolean;
  trialUsed: boolean;
  availableIntervals: Array<'month' | 'year'>;
  nextOwnerAction: string | null;
  readOnlyReason: string | null;
};

export const isBillingInterval = (value: string | null): 'month' | 'year' | null => {
  if (value === 'month' || value === 'year') {
    return value;
  }
  return null;
};

export const isBillingSubscriptionStatus = (
  value: string | null,
): OrganizationBillingSubscriptionStatus | null => {
  if (
    value === 'free' ||
    value === 'trialing' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'canceled' ||
    value === 'unpaid' ||
    value === 'incomplete'
  ) {
    return value;
  }
  return null;
};

export const hasActivePremiumSubscription = (value: string | null): boolean => {
  return (
    value === 'trialing' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'unpaid' ||
    value === 'incomplete'
  );
};

export const ensureOrganizationBillingRow = async (
  database: AuthRuntimeDatabase,
  organizationId: string,
) => {
  await database
    .insert(dbSchema.organizationBilling)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      planCode: 'free',
      subscriptionStatus: 'free',
    })
    .onConflictDoNothing();
};

export const hasOrganizationStartedPremiumTrial = async ({
  database,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
}) => {
  await ensureOrganizationBillingRow(database, organizationId);

  const billingRows = await database
    .select({
      trialStartedAt: dbSchema.organizationBilling.trialStartedAt,
    })
    .from(dbSchema.organizationBilling)
    .where(eq(dbSchema.organizationBilling.organizationId, organizationId))
    .limit(1);

  if (billingRows[0]?.trialStartedAt) {
    return true;
  }

  const auditRows = await database
    .select({
      count: count(),
    })
    .from(dbSchema.organizationBillingAuditEvent)
    .where(
      and(
        eq(dbSchema.organizationBillingAuditEvent.organizationId, organizationId),
        eq(dbSchema.organizationBillingAuditEvent.sourceKind, 'trial_start'),
      ),
    );

  return Number(auditRows[0]?.count ?? 0) > 0;
};

export const startOrganizationPremiumTrial = async ({
  database,
  organizationId,
  now = new Date(),
  trialStartedAt = now,
  trialEndsAt = new Date(
    trialStartedAt.getTime() + ORGANIZATION_PREMIUM_TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000,
  ),
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripePriceId = null,
  billingInterval = null,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  now?: Date;
  trialStartedAt?: Date;
  trialEndsAt?: Date;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  billingInterval?: 'month' | 'year' | null;
}) => {
  await ensureOrganizationBillingRow(database, organizationId);

  await database
    .update(dbSchema.organizationBilling)
    .set({
      planCode: 'premium',
      billingInterval,
      subscriptionStatus: 'trialing',
      cancelAtPeriodEnd: false,
      trialStartedAt,
      trialEndedAt: null,
      currentPeriodStart: trialStartedAt,
      currentPeriodEnd: trialEndsAt,
      paymentIssueStartedAt: null,
      pastDueGraceEndsAt: null,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId,
    })
    .where(eq(dbSchema.organizationBilling.organizationId, organizationId));

  return {
    trialStartedAt,
    trialEndsAt,
  };
};

export const updateOrganizationBillingStripeCustomerId = async ({
  database,
  organizationId,
  stripeCustomerId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  stripeCustomerId: string;
}) => {
  await ensureOrganizationBillingRow(database, organizationId);

  await database
    .update(dbSchema.organizationBilling)
    .set({
      stripeCustomerId,
    })
    .where(eq(dbSchema.organizationBilling.organizationId, organizationId));
};

export const selectOrganizationBillingSummary = async (
  database: AuthRuntimeDatabase,
  organizationId: string,
) => {
  await ensureOrganizationBillingRow(database, organizationId);

  const rows = await database
    .select({
      planCode: dbSchema.organizationBilling.planCode,
      billingInterval: dbSchema.organizationBilling.billingInterval,
      subscriptionStatus: dbSchema.organizationBilling.subscriptionStatus,
      cancelAtPeriodEnd: dbSchema.organizationBilling.cancelAtPeriodEnd,
      trialStartedAt: dbSchema.organizationBilling.trialStartedAt,
      trialEndedAt: dbSchema.organizationBilling.trialEndedAt,
      currentPeriodStart: dbSchema.organizationBilling.currentPeriodStart,
      currentPeriodEnd: dbSchema.organizationBilling.currentPeriodEnd,
      paymentIssueStartedAt: dbSchema.organizationBilling.paymentIssueStartedAt,
      pastDueGraceEndsAt: dbSchema.organizationBilling.pastDueGraceEndsAt,
      billingProfileReadiness: dbSchema.organizationBilling.billingProfileReadiness,
      billingProfileNextAction: dbSchema.organizationBilling.billingProfileNextAction,
      billingProfileCheckedAt: dbSchema.organizationBilling.billingProfileCheckedAt,
      lastReconciledAt: dbSchema.organizationBilling.lastReconciledAt,
      lastReconciliationReason: dbSchema.organizationBilling.lastReconciliationReason,
      stripeCustomerId: dbSchema.organizationBilling.stripeCustomerId,
      stripeSubscriptionId: dbSchema.organizationBilling.stripeSubscriptionId,
      stripePriceId: dbSchema.organizationBilling.stripePriceId,
    })
    .from(dbSchema.organizationBilling)
    .where(eq(dbSchema.organizationBilling.organizationId, organizationId))
    .limit(1);

  return rows[0] ?? null;
};

export const resolveOrganizationBillingProfileReadiness = (
  billing: Awaited<ReturnType<typeof selectOrganizationBillingSummary>>,
): OrganizationBillingProfileReadiness =>
  buildBillingProfileReadiness({
    state: billing?.billingProfileReadiness ?? 'not_required',
    nextAction: billing?.billingProfileNextAction ?? null,
    checkedAt: billing?.billingProfileCheckedAt ?? null,
  });

export const resolveOrganizationBillingActionAvailability = ({
  billing,
  canManageBilling,
  trialUsed,
  stripeBillingConfigured,
  availableIntervals,
}: {
  billing: Awaited<ReturnType<typeof selectOrganizationBillingSummary>>;
  canManageBilling: boolean;
  trialUsed: boolean;
  stripeBillingConfigured: boolean;
  availableIntervals: Array<'month' | 'year'>;
}): OrganizationBillingActionAvailability => {
  const planCode: OrganizationBillingPlanCode =
    billing?.planCode === 'premium' ? 'premium' : 'free';
  const subscriptionStatus =
    isBillingSubscriptionStatus(billing?.subscriptionStatus ?? null) ?? 'free';
  const providerLinked = Boolean(billing?.stripeCustomerId && billing?.stripeSubscriptionId);
  const hasProviderManagedSubscription =
    planCode === 'premium' &&
    providerLinked &&
    (subscriptionStatus === 'active' ||
      subscriptionStatus === 'trialing' ||
      subscriptionStatus === 'past_due' ||
      subscriptionStatus === 'unpaid' ||
      subscriptionStatus === 'incomplete');
  const canStartTrial =
    canManageBilling && !trialUsed && planCode === 'free' && subscriptionStatus === 'free';
  const canStartPaidCheckout =
    canManageBilling &&
    stripeBillingConfigured &&
    availableIntervals.length > 0 &&
    (planCode === 'free' || subscriptionStatus === 'free' || subscriptionStatus === 'canceled') &&
    !hasProviderManagedSubscription;
  const canRegisterPaymentMethod =
    canManageBilling &&
    stripeBillingConfigured &&
    planCode === 'premium' &&
    subscriptionStatus === 'trialing';
  const canOpenBillingPortal =
    canManageBilling && stripeBillingConfigured && hasProviderManagedSubscription;
  const readOnlyReason = canManageBilling ? null : 'billing_management_requires_organization_owner';
  const nextOwnerAction =
    readOnlyReason ??
    (canStartTrial
      ? 'start_trial'
      : canStartPaidCheckout
        ? 'start_paid_checkout'
        : canRegisterPaymentMethod
          ? 'register_payment_method'
          : canOpenBillingPortal
            ? 'open_billing_portal'
            : null);

  return {
    canStartTrial,
    canStartPaidCheckout,
    canRegisterPaymentMethod,
    canOpenBillingPortal,
    trialUsed,
    availableIntervals,
    nextOwnerAction,
    readOnlyReason,
  };
};

export const resolveOrganizationBillingPlanState = ({
  planCode,
  subscriptionStatus,
}: {
  planCode: OrganizationBillingPlanCode;
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
}): OrganizationBillingPlanState => {
  if (planCode !== 'premium') {
    return 'free';
  }

  return subscriptionStatus === 'trialing' ? 'premium_trial' : 'premium_paid';
};

export const resolveOrganizationBillingTrialEndsAt = ({
  planState,
  currentPeriodEnd,
}: {
  planState: OrganizationBillingPlanState;
  currentPeriodEnd: string | null;
}): string | null => {
  return planState === 'premium_trial' ? currentPeriodEnd : null;
};

export const resolveOrganizationBillingPaymentMethodEvaluation = async ({
  env,
  planCode,
  stripeCustomerId,
}: {
  env: AuthRuntimeEnv;
  planCode: OrganizationBillingPlanCode;
  stripeCustomerId: string | null;
}): Promise<OrganizationBillingPaymentMethodEvaluation> => {
  if (planCode !== 'premium') {
    return {
      status: 'not_started',
      reason: 'plan_is_free',
    };
  }

  if (!stripeCustomerId) {
    return {
      status: 'not_started',
      reason: 'missing_customer',
    };
  }

  if (!env.STRIPE_SECRET_KEY?.trim()) {
    return {
      status: 'pending',
      reason: 'stripe_not_configured',
    };
  }

  try {
    const customer = await readStripeCustomerSummary({
      env,
      customerId: stripeCustomerId,
    });
    if (customer.defaultPaymentMethodId) {
      return {
        status: 'registered',
        reason: 'default_payment_method_registered',
      };
    }

    return {
      status: 'pending',
      reason: 'missing_default_payment_method',
    };
  } catch {
    return {
      status: 'pending',
      reason: 'stripe_lookup_failed',
    };
  }
};

export const resolveOrganizationBillingPaymentMethodStatus = async ({
  env,
  planCode,
  stripeCustomerId,
}: {
  env: AuthRuntimeEnv;
  planCode: OrganizationBillingPlanCode;
  stripeCustomerId: string | null;
}): Promise<OrganizationBillingPaymentMethodStatus> => {
  const paymentMethod = await resolveOrganizationBillingPaymentMethodEvaluation({
    env,
    planCode,
    stripeCustomerId,
  });

  return paymentMethod.status;
};

export const applyOrganizationPremiumTrialCompletion = async ({
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
  const billing = await selectOrganizationBillingSummary(database, organizationId);
  if (billing?.planCode !== 'premium' || billing.subscriptionStatus !== 'trialing') {
    return {
      ok: false,
      status: 409,
      message: ORGANIZATION_PREMIUM_TRIAL_COMPLETION_CONFLICT_MESSAGE,
    };
  }

  const trialEndsAt = billing.currentPeriodEnd instanceof Date ? billing.currentPeriodEnd : null;
  if (!trialEndsAt || trialEndsAt.getTime() > now.getTime()) {
    return {
      ok: false,
      status: 409,
      message: ORGANIZATION_PREMIUM_TRIAL_COMPLETION_NOT_READY_MESSAGE,
    };
  }

  const paymentMethod = await resolveOrganizationBillingPaymentMethodEvaluation({
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
      const latestSubscriptionStatus = isBillingSubscriptionStatus(latestSubscription.status);
      if (
        latestSubscriptionStatus &&
        latestSubscriptionStatus !== 'trialing' &&
        latestSubscriptionStatus !== 'free'
      ) {
        const isCanceled = latestSubscriptionStatus === 'canceled';
        await database
          .update(dbSchema.organizationBilling)
          .set({
            planCode: isCanceled ? 'free' : 'premium',
            billingInterval: isCanceled
              ? null
              : resolveBillingIntervalFromPriceId(env, latestSubscription.priceId),
            subscriptionStatus: isCanceled ? 'free' : latestSubscriptionStatus,
            cancelAtPeriodEnd: isCanceled ? false : latestSubscription.cancelAtPeriodEnd,
            trialEndedAt: now,
            currentPeriodStart: isCanceled ? null : latestSubscription.currentPeriodStart,
            currentPeriodEnd: isCanceled ? null : latestSubscription.currentPeriodEnd,
            paymentIssueStartedAt: null,
            pastDueGraceEndsAt: null,
            stripeSubscriptionId: isCanceled ? null : latestSubscription.id,
            stripePriceId: isCanceled ? null : latestSubscription.priceId,
          })
          .where(eq(dbSchema.organizationBilling.organizationId, organizationId));

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
        message: ORGANIZATION_PREMIUM_TRIAL_COMPLETION_PENDING_MESSAGE,
      };
    }

    return {
      ok: false,
      status: 503,
      message: ORGANIZATION_PREMIUM_TRIAL_COMPLETION_PENDING_MESSAGE,
    };
  }

  if (paymentMethod.reason === 'default_payment_method_registered') {
    await database
      .update(dbSchema.organizationBilling)
      .set({
        planCode: 'premium',
        billingInterval: isBillingInterval(billing.billingInterval ?? null),
        subscriptionStatus: 'active',
        cancelAtPeriodEnd: false,
        trialEndedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: null,
        paymentIssueStartedAt: null,
        pastDueGraceEndsAt: null,
      })
      .where(eq(dbSchema.organizationBilling.organizationId, organizationId));

    return {
      ok: true,
      message: 'Organization premium trial converted to premium paid.',
    };
  }

  if (
    paymentMethod.reason === 'missing_customer' ||
    paymentMethod.reason === 'missing_default_payment_method'
  ) {
    await database
      .update(dbSchema.organizationBilling)
      .set({
        planCode: 'free',
        billingInterval: null,
        subscriptionStatus: 'free',
        cancelAtPeriodEnd: false,
        trialEndedAt: now,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        paymentIssueStartedAt: null,
        pastDueGraceEndsAt: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
      })
      .where(eq(dbSchema.organizationBilling.organizationId, organizationId));

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
        message: ORGANIZATION_PREMIUM_TRIAL_COMPLETION_PENDING_MESSAGE,
      };
};

export const resolveBillingIntervalFromPriceId = (
  env: AuthRuntimeEnv,
  priceId: string | null,
): 'month' | 'year' | null => {
  if (!priceId) {
    return null;
  }
  if (env.STRIPE_PREMIUM_MONTHLY_PRICE_ID?.trim() === priceId) {
    return 'month';
  }
  if (env.STRIPE_PREMIUM_YEARLY_PRICE_ID?.trim() === priceId) {
    return 'year';
  }
  return null;
};

const resolvePaymentIssueFields = ({
  subscriptionStatus,
  existingPaymentIssueStartedAt,
  existingPastDueGraceEndsAt,
  now,
}: {
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
  existingPaymentIssueStartedAt?: Date | null;
  existingPastDueGraceEndsAt?: Date | null;
  now: Date;
}) => {
  if (subscriptionStatus === 'past_due') {
    const paymentIssueStartedAt = existingPaymentIssueStartedAt ?? now;
    return {
      paymentIssueStartedAt,
      pastDueGraceEndsAt:
        existingPastDueGraceEndsAt ??
        new Date(
          paymentIssueStartedAt.getTime() +
            ORGANIZATION_BILLING_PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000,
        ),
    };
  }

  if (subscriptionStatus === 'incomplete' || subscriptionStatus === 'unpaid') {
    return {
      paymentIssueStartedAt: existingPaymentIssueStartedAt ?? now,
      pastDueGraceEndsAt: null,
    };
  }

  return {
    paymentIssueStartedAt: null,
    pastDueGraceEndsAt: null,
  };
};

export const upsertOrganizationBillingByOrganizationId = async ({
  database,
  organizationId,
  planCode,
  stripeCustomerId,
  stripeSubscriptionId,
  stripePriceId,
  billingInterval,
  subscriptionStatus,
  cancelAtPeriodEnd,
  currentPeriodStart,
  currentPeriodEnd,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  planCode: OrganizationBillingPlanCode;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  billingInterval?: 'month' | 'year' | null;
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
  cancelAtPeriodEnd?: boolean;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  now?: Date;
}) => {
  await ensureOrganizationBillingRow(database, organizationId);
  const existingRows = await database
    .select({
      paymentIssueStartedAt: dbSchema.organizationBilling.paymentIssueStartedAt,
      pastDueGraceEndsAt: dbSchema.organizationBilling.pastDueGraceEndsAt,
    })
    .from(dbSchema.organizationBilling)
    .where(eq(dbSchema.organizationBilling.organizationId, organizationId))
    .limit(1);
  const paymentIssueFields = resolvePaymentIssueFields({
    subscriptionStatus,
    existingPaymentIssueStartedAt: existingRows[0]?.paymentIssueStartedAt ?? null,
    existingPastDueGraceEndsAt: existingRows[0]?.pastDueGraceEndsAt ?? null,
    now,
  });
  await database
    .insert(dbSchema.organizationBilling)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      planCode,
      stripeCustomerId: stripeCustomerId ?? null,
      stripeSubscriptionId: stripeSubscriptionId ?? null,
      stripePriceId: stripePriceId ?? null,
      billingInterval: billingInterval ?? null,
      subscriptionStatus,
      cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
      trialStartedAt: subscriptionStatus === 'trialing' ? (currentPeriodStart ?? new Date()) : null,
      trialEndedAt: null,
      currentPeriodStart: currentPeriodStart ?? null,
      currentPeriodEnd: currentPeriodEnd ?? null,
      paymentIssueStartedAt: paymentIssueFields.paymentIssueStartedAt,
      pastDueGraceEndsAt: paymentIssueFields.pastDueGraceEndsAt,
    })
    .onConflictDoUpdate({
      target: dbSchema.organizationBilling.organizationId,
      set: {
        planCode,
        stripeCustomerId: stripeCustomerId ?? null,
        stripeSubscriptionId: stripeSubscriptionId ?? null,
        stripePriceId: stripePriceId ?? null,
        billingInterval: billingInterval ?? null,
        subscriptionStatus,
        cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
        trialStartedAt:
          subscriptionStatus === 'trialing'
            ? (currentPeriodStart ?? new Date())
            : sql`${dbSchema.organizationBilling.trialStartedAt}`,
        trialEndedAt:
          subscriptionStatus === 'trialing'
            ? null
            : sql`${dbSchema.organizationBilling.trialEndedAt}`,
        currentPeriodStart: currentPeriodStart ?? null,
        currentPeriodEnd: currentPeriodEnd ?? null,
        paymentIssueStartedAt: paymentIssueFields.paymentIssueStartedAt,
        pastDueGraceEndsAt: paymentIssueFields.pastDueGraceEndsAt,
        updatedAt: new Date(),
      },
    });
};

export const selectOrganizationBillingByStripeIdentifiers = async ({
  database,
  stripeCustomerId,
  stripeSubscriptionId,
}: {
  database: AuthRuntimeDatabase;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}) => {
  const filters: SQL[] = [];
  if (stripeSubscriptionId) {
    filters.push(eq(dbSchema.organizationBilling.stripeSubscriptionId, stripeSubscriptionId));
  }
  if (stripeCustomerId) {
    filters.push(eq(dbSchema.organizationBilling.stripeCustomerId, stripeCustomerId));
  }
  if (filters.length === 0) {
    return null;
  }

  const rows = await database
    .select({
      organizationId: dbSchema.organizationBilling.organizationId,
    })
    .from(dbSchema.organizationBilling)
    .where(filters.length === 1 ? filters[0] : or(...filters))
    .limit(1);

  return rows[0] ?? null;
};
