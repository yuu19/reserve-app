import { eq, or, type SQL } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import { readStripeCustomerSummary } from '../payment/stripe.js';

export const ORGANIZATION_PREMIUM_TRIAL_DURATION_DAYS = 7;
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
    value === 'free'
    || value === 'trialing'
    || value === 'active'
    || value === 'past_due'
    || value === 'canceled'
    || value === 'unpaid'
    || value === 'incomplete'
  ) {
    return value;
  }
  return null;
};

export const hasActivePremiumSubscription = (value: string | null): boolean => {
  return (
    value === 'trialing'
    || value === 'active'
    || value === 'past_due'
    || value === 'unpaid'
    || value === 'incomplete'
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

export const startOrganizationPremiumTrial = async ({
  database,
  organizationId,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  now?: Date;
}) => {
  await ensureOrganizationBillingRow(database, organizationId);

  const trialStartedAt = now;
  const trialEndsAt = new Date(
    trialStartedAt.getTime() + ORGANIZATION_PREMIUM_TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000,
  );

  await database
    .update(dbSchema.organizationBilling)
    .set({
      planCode: 'premium',
      billingInterval: null,
      subscriptionStatus: 'trialing',
      cancelAtPeriodEnd: false,
      currentPeriodStart: trialStartedAt,
      currentPeriodEnd: trialEndsAt,
      stripeSubscriptionId: null,
      stripePriceId: null,
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
      currentPeriodStart: dbSchema.organizationBilling.currentPeriodStart,
      currentPeriodEnd: dbSchema.organizationBilling.currentPeriodEnd,
      stripeCustomerId: dbSchema.organizationBilling.stripeCustomerId,
      stripeSubscriptionId: dbSchema.organizationBilling.stripeSubscriptionId,
      stripePriceId: dbSchema.organizationBilling.stripePriceId,
    })
    .from(dbSchema.organizationBilling)
    .where(eq(dbSchema.organizationBilling.organizationId, organizationId))
    .limit(1);

  return rows[0] ?? null;
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
  if (paymentMethod.reason === 'default_payment_method_registered') {
    await database
      .update(dbSchema.organizationBilling)
      .set({
        planCode: 'premium',
        billingInterval: isBillingInterval(billing.billingInterval ?? null),
        subscriptionStatus: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodStart: now,
        currentPeriodEnd: null,
      })
      .where(eq(dbSchema.organizationBilling.organizationId, organizationId));

    return {
      ok: true,
      message: 'Organization premium trial converted to premium paid.',
    };
  }

  if (
    paymentMethod.reason === 'missing_customer'
    || paymentMethod.reason === 'missing_default_payment_method'
  ) {
    await database
      .update(dbSchema.organizationBilling)
      .set({
        planCode: 'free',
        billingInterval: null,
        subscriptionStatus: 'free',
        cancelAtPeriodEnd: false,
        currentPeriodStart: null,
        currentPeriodEnd: null,
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
}) => {
  await ensureOrganizationBillingRow(database, organizationId);
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
      currentPeriodStart: currentPeriodStart ?? null,
      currentPeriodEnd: currentPeriodEnd ?? null,
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
        currentPeriodStart: currentPeriodStart ?? null,
        currentPeriodEnd: currentPeriodEnd ?? null,
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
