import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import {
  selectOrganizationBillingSummary,
  type OrganizationBillingPaymentIssueState,
} from '../../domain/billing/organization-billing.js';
import type { OrganizationBillingInvoicePaymentEventType } from '../../domain/billing/organization-billing-invoice-events.js';
import {
  projectReserveAppEntitlements,
  reserveAppBillingSubject,
} from '../../features/billing/policies/reserve-app-billing-policy.js';
import { createDrizzleBillingStore } from './drizzle-billing-store.js';

const resolveSubscriptionStatus = (
  value: string | null | undefined,
): 'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' => {
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

const resolveBillingInterval = (value: string | null | undefined): 'month' | 'year' | null =>
  value === 'month' || value === 'year' ? value : null;

const resolvePaymentIssueState = ({
  subscriptionStatus,
  pastDueGraceEndsAt,
  now,
}: {
  subscriptionStatus: ReturnType<typeof resolveSubscriptionStatus>;
  pastDueGraceEndsAt?: Date | null;
  now: Date;
}): OrganizationBillingPaymentIssueState => {
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

const isUnknownPremiumPrice = ({
  env,
  planCode,
  stripePriceId,
}: {
  env: AuthRuntimeEnv;
  planCode: 'free' | 'premium';
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

export const syncReserveAppBillingV2Projection = async ({
  database,
  env,
  organizationId,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  now?: Date;
}) => {
  const billing = await selectOrganizationBillingSummary(database, organizationId);
  const billingStore = createDrizzleBillingStore({ database });
  const subject = reserveAppBillingSubject(organizationId);
  let account = await billingStore.ensureAccount({
    ...subject,
    provider: 'stripe',
  });

  if (billing?.stripeCustomerId) {
    await billingStore.updateProviderCustomerId({
      billingAccountId: account.id,
      providerCustomerId: billing.stripeCustomerId,
    });
    account = {
      ...account,
      providerCustomerId: billing.stripeCustomerId,
    };
  }

  const planCode = billing?.planCode === 'premium' ? 'premium' : 'free';
  const subscriptionStatus = resolveSubscriptionStatus(billing?.subscriptionStatus);
  const projectedPaymentIssueState = resolvePaymentIssueState({
    subscriptionStatus,
    pastDueGraceEndsAt: billing?.pastDueGraceEndsAt ?? null,
    now,
  });
  const subscription = await billingStore.upsertSubscription({
    billingAccountId: account.id,
    provider: 'stripe',
    providerSubscriptionId: billing?.stripeSubscriptionId ?? null,
    planCode,
    priceCode: billing?.stripePriceId ?? null,
    interval: resolveBillingInterval(billing?.billingInterval),
    status: subscriptionStatus,
    currentPeriodStart: billing?.currentPeriodStart ?? null,
    currentPeriodEnd: billing?.currentPeriodEnd ?? null,
    trialStart: billing?.trialStartedAt ?? null,
    trialEnd: subscriptionStatus === 'trialing' ? (billing?.currentPeriodEnd ?? null) : null,
    cancelAtPeriodEnd: Boolean(billing?.cancelAtPeriodEnd),
  });
  const currentPaymentIssue = await billingStore.readPaymentIssue({
    billingAccountId: account.id,
  });
  const preservedEventDerivedIssue =
    projectedPaymentIssueState === 'none' &&
    currentPaymentIssue &&
    (currentPaymentIssue.state === 'payment_failed' ||
      currentPaymentIssue.state === 'payment_action_required' ||
      currentPaymentIssue.state === 'recovered' ||
      currentPaymentIssue.state === 'stale_failure_history_only');
  const paymentIssueState = preservedEventDerivedIssue
    ? currentPaymentIssue.state
    : projectedPaymentIssueState;

  await billingStore.upsertPaymentIssue({
    billingAccountId: account.id,
    billingSubscriptionId: subscription.id,
    state: paymentIssueState,
    issueStartedAt: preservedEventDerivedIssue
      ? currentPaymentIssue.issueStartedAt
      : (billing?.paymentIssueStartedAt ?? null),
    issueStartedAtSource: preservedEventDerivedIssue
      ? currentPaymentIssue.issueStartedAtSource
      : billing?.paymentIssueStartedAt
        ? 'application_receipt_time'
        : 'none',
    pastDueGraceEndsAt: preservedEventDerivedIssue
      ? currentPaymentIssue.pastDueGraceEndsAt
      : (billing?.pastDueGraceEndsAt ?? null),
    latestProviderEventId: preservedEventDerivedIssue
      ? currentPaymentIssue.latestProviderEventId
      : null,
    latestInvoiceId: preservedEventDerivedIssue ? currentPaymentIssue.latestInvoiceId : null,
    latestPaymentIntentId: preservedEventDerivedIssue
      ? currentPaymentIssue.latestPaymentIntentId
      : null,
  });

  await billingStore.replaceEntitlements({
    billingAccountId: account.id,
    entitlements: projectReserveAppEntitlements({
      planCode,
      subscriptionStatus,
      trialEnd: subscription.trialEnd,
      currentPeriodEnd: subscription.currentPeriodEnd,
      paymentIssue: {
        state: paymentIssueState,
        pastDueGraceEndsAt: billing?.pastDueGraceEndsAt ?? null,
      },
      unknownPrice: isUnknownPremiumPrice({
        env,
        planCode,
        stripePriceId: billing?.stripePriceId ?? null,
      }),
      now,
    }),
  });

  return {
    account,
    subscription,
    paymentIssueState,
  };
};

const resolveIssueEventState = ({
  invoiceEventType,
  projectedPaymentIssueState,
  stalePaymentIssueAfterRecovery,
}: {
  invoiceEventType: OrganizationBillingInvoicePaymentEventType;
  projectedPaymentIssueState: OrganizationBillingPaymentIssueState;
  stalePaymentIssueAfterRecovery?: boolean;
}): OrganizationBillingPaymentIssueState | null => {
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
  const projection = await syncReserveAppBillingV2Projection({
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

  return projection;
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
  const legacyBilling = await selectOrganizationBillingSummary(database, organizationId);
  const projection = await syncReserveAppBillingV2Projection({
    database,
    env,
    organizationId,
  });
  const billingStore = createDrizzleBillingStore({ database });
  const paymentIssue = await billingStore.readPaymentIssue({
    billingAccountId: projection.account.id,
  });
  const planCode = projection.subscription.planCode === 'premium' ? 'premium' : 'free';

  return {
    planCode,
    billingInterval: resolveBillingInterval(projection.subscription.interval),
    subscriptionStatus: resolveSubscriptionStatus(projection.subscription.status),
    cancelAtPeriodEnd: projection.subscription.cancelAtPeriodEnd,
    trialStartedAt: projection.subscription.trialStart,
    trialEndedAt: legacyBilling?.trialEndedAt ?? null,
    currentPeriodStart: projection.subscription.currentPeriodStart,
    currentPeriodEnd: projection.subscription.currentPeriodEnd,
    paymentIssueStartedAt: paymentIssue?.issueStartedAt ?? null,
    pastDueGraceEndsAt: paymentIssue?.pastDueGraceEndsAt ?? null,
    billingProfileReadiness: legacyBilling?.billingProfileReadiness ?? 'not_required',
    billingProfileNextAction: legacyBilling?.billingProfileNextAction ?? null,
    billingProfileCheckedAt: legacyBilling?.billingProfileCheckedAt ?? null,
    lastReconciledAt: legacyBilling?.lastReconciledAt ?? null,
    lastReconciliationReason: legacyBilling?.lastReconciliationReason ?? null,
    stripeCustomerId: projection.account.providerCustomerId,
    stripeSubscriptionId: projection.subscription.providerSubscriptionId,
    stripePriceId: projection.subscription.priceCode,
  };
};
