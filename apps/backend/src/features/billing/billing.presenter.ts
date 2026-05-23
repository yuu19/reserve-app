import type { OrganizationRole } from '../../domain/booking/authorization.js';
import { buildBillingDocumentReadiness } from '../../domain/billing/organization-billing-documents.js';
import type { ReserveAppBillingInvoiceEvent } from '../../domain/billing/reserve-app-billing-invoice-events.js';
import type {
  OrganizationBillingOperationAttempt,
  OrganizationBillingOperationPurpose,
} from '../../domain/billing/organization-billing-operations.js';
import { resolveOrganizationPremiumEntitlementPolicy } from '../../domain/billing/organization-billing-policy.js';
import {
  resolveOrganizationBillingActionAvailability,
  resolveOrganizationBillingProfileReadiness,
} from '../../domain/billing/organization-billing.js';
import type { AuthRuntimeEnv } from '../../auth-runtime.js';
import {
  buildOrganizationBillingCatalog,
  listOrganizationBillingCatalogIntervals,
} from './billing.catalog.js';
import {
  isReserveAppBillingInterval,
  isReserveAppBillingSubscriptionStatus,
  resolveReserveAppBillingPaymentIssueState,
  resolveReserveAppBillingPaymentIssueTiming,
  resolveReserveAppBillingPaymentMethodStatus,
  type ReserveAppBillingSubscriptionStatus,
} from './policies/reserve-app-billing-policy.js';
import type { OrganizationBillingStore } from './billing.store.js';

export const toIsoDateString = (value: unknown): string | null => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }

  if (typeof value === 'string') {
    return value;
  }

  return null;
};

export const toTimestamp = (value: unknown): number | null => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

export const getPaymentEventTime = (event: ReserveAppBillingInvoiceEvent) =>
  toTimestamp(event.occurredAt) ?? toTimestamp(event.createdAt);

export const buildBillingHandoff = ({
  attempt,
  purpose,
  reused,
}: {
  attempt: OrganizationBillingOperationAttempt | null;
  purpose: OrganizationBillingOperationPurpose;
  reused: boolean;
}) => {
  if (!attempt?.handoffUrl || !attempt.handoffExpiresAt) {
    return null;
  }
  return {
    provider: 'stripe' as const,
    purpose,
    url: attempt.handoffUrl,
    expiresAt: attempt.handoffExpiresAt.toISOString(),
    reused,
    operationAttemptId: attempt.id,
  };
};

export const resolvePaymentIssueContext = ({
  subscriptionStatus,
  entitlementReason,
  paymentIssueStartedAt,
  pastDueGraceEndsAt,
  invoicePaymentEvents,
}: {
  subscriptionStatus: ReserveAppBillingSubscriptionStatus;
  entitlementReason: string;
  paymentIssueStartedAt: unknown;
  pastDueGraceEndsAt: unknown;
  invoicePaymentEvents: ReserveAppBillingInvoiceEvent[];
}) => {
  const latestIssueEvent = invoicePaymentEvents.find(
    (
      event,
    ): event is ReserveAppBillingInvoiceEvent & {
      eventType: 'payment_failed' | 'payment_action_required';
    } => event.eventType === 'payment_failed' || event.eventType === 'payment_action_required',
  );
  const latestSucceededEvent = invoicePaymentEvents.find(
    (event) => event.eventType === 'payment_succeeded',
  );
  const issueEventTime = latestIssueEvent ? getPaymentEventTime(latestIssueEvent) : null;
  const latestSucceededTime = latestSucceededEvent
    ? getPaymentEventTime(latestSucceededEvent)
    : null;
  const hasRecoveredPaymentIssueHistory = Boolean(
    latestSucceededEvent &&
    invoicePaymentEvents.some(
      (event) =>
        event.eventType === 'payment_failed' || event.eventType === 'payment_action_required',
    ),
  );
  const hasStaleFailureHistory = Boolean(
    latestIssueEvent &&
    latestSucceededTime !== null &&
    issueEventTime !== null &&
    issueEventTime > latestSucceededTime &&
    (subscriptionStatus === 'active' ||
      subscriptionStatus === 'trialing' ||
      subscriptionStatus === 'free' ||
      subscriptionStatus === 'canceled'),
  );
  const latestPaymentIssueEventType:
    | 'payment_failed'
    | 'payment_action_required'
    | 'payment_succeeded'
    | null =
    latestSucceededEvent &&
    latestSucceededTime !== null &&
    (issueEventTime === null || latestSucceededTime >= issueEventTime)
      ? 'payment_succeeded'
      : (latestIssueEvent?.eventType ?? null);

  return {
    paymentIssueState: resolveReserveAppBillingPaymentIssueState({
      subscriptionStatus,
      entitlementReason,
      latestPaymentIssueEventType,
      hasRecoveredPaymentIssueHistory,
      hasStaleFailureHistory,
    }),
    paymentIssueTiming: resolveReserveAppBillingPaymentIssueTiming({
      paymentIssueStartedAt: toIsoDateString(paymentIssueStartedAt),
      pastDueGraceEndsAt: toIsoDateString(pastDueGraceEndsAt),
      providerIssueStartedAt: latestIssueEvent?.occurredAt ?? null,
    }),
  };
};

const resolveBillingAvailableIntervals = (env: AuthRuntimeEnv): Array<'month' | 'year'> => {
  return listOrganizationBillingCatalogIntervals(buildOrganizationBillingCatalog(env));
};

export const readOrganizationBillingSummaryPayload = async ({
  store,
  env,
  organizationId,
  role,
}: {
  store: OrganizationBillingStore;
  env: AuthRuntimeEnv;
  organizationId: string;
  role: OrganizationRole;
}) => {
  const billing = await store.selectSummary(organizationId);
  const planCode: 'free' | 'premium' = billing?.planCode === 'premium' ? 'premium' : 'free';
  const billingInterval = isReserveAppBillingInterval(billing?.billingInterval ?? null);
  const subscriptionStatus =
    isReserveAppBillingSubscriptionStatus(billing?.subscriptionStatus ?? null) ?? 'free';
  const trialStartedAt = toIsoDateString(billing?.trialStartedAt);
  const currentPeriodEnd = toIsoDateString(billing?.currentPeriodEnd);
  const pastDueGraceEndsAt = toIsoDateString(billing?.pastDueGraceEndsAt);
  const paymentMethodStatus = await resolveReserveAppBillingPaymentMethodStatus({
    env,
    planCode,
    stripeCustomerId: billing?.stripeCustomerId ?? null,
  });
  const entitlementPolicy = resolveOrganizationPremiumEntitlementPolicy({
    planCode,
    subscriptionStatus,
    paymentMethodStatus,
    currentPeriodEnd,
    pastDueGraceEndsAt,
    cancelAtPeriodEnd: Boolean(billing?.cancelAtPeriodEnd),
    stripePriceId: billing?.stripePriceId ?? null,
    env,
  });
  const canManageBilling = role === 'owner';
  const trialUsed = await store.hasStartedPremiumTrial({
    organizationId,
  });
  const actionAvailability = resolveOrganizationBillingActionAvailability({
    billing,
    canManageBilling,
    trialUsed,
    stripeBillingConfigured: Boolean(env.STRIPE_SECRET_KEY?.trim()),
    availableIntervals: resolveBillingAvailableIntervals(env),
  });
  const invoicePaymentEventsForContext = await store.readInvoicePaymentEvents({
    organizationId,
  });
  const paymentIssueContext = resolvePaymentIssueContext({
    subscriptionStatus,
    entitlementReason: entitlementPolicy.reason,
    paymentIssueStartedAt: billing?.paymentIssueStartedAt ?? null,
    pastDueGraceEndsAt: billing?.pastDueGraceEndsAt ?? null,
    invoicePaymentEvents: invoicePaymentEventsForContext,
  });
  const [history, documentReferences] =
    role === 'owner'
      ? await Promise.all([
          store.readOwnerBillingHistory({ organizationId }).then((result) => result.entries),
          store.readDocumentReferences({ organizationId }),
        ])
      : [null, []];
  const invoicePaymentEvents = role === 'owner' ? invoicePaymentEventsForContext : [];
  const paymentDocuments =
    role === 'owner'
      ? buildBillingDocumentReadiness({
          organizationId,
          stripeCustomerId: billing?.stripeCustomerId ?? null,
          stripeSubscriptionId: billing?.stripeSubscriptionId ?? null,
          documents: documentReferences,
        })
      : null;

  return {
    organizationId,
    planCode,
    planState: entitlementPolicy.planState,
    paidTier: entitlementPolicy.paidTier,
    billingInterval,
    subscriptionStatus,
    cancelAtPeriodEnd: Boolean(billing?.cancelAtPeriodEnd),
    trialStartedAt,
    currentPeriodEnd,
    paymentIssueStartedAt: toIsoDateString(billing?.paymentIssueStartedAt),
    pastDueGraceEndsAt,
    paymentIssueState: paymentIssueContext.paymentIssueState,
    paymentIssueTiming: paymentIssueContext.paymentIssueTiming,
    nextOwnerAction: actionAvailability.nextOwnerAction,
    lastReconciledAt: toIsoDateString(billing?.lastReconciledAt),
    lastReconciliationReason: billing?.lastReconciliationReason ?? null,
    trialEndsAt: entitlementPolicy.trialEndsAt,
    premiumEligible: entitlementPolicy.isPremiumEligible,
    entitlementState: entitlementPolicy.entitlementState,
    entitlementReason: entitlementPolicy.reason,
    capabilities: entitlementPolicy.paidTier?.capabilities ?? [],
    paymentMethodStatus,
    canViewBilling: true,
    canManageBilling,
    actionAvailability,
    billingProfileReadiness: resolveOrganizationBillingProfileReadiness(billing),
    history,
    paymentDocuments,
    invoicePaymentEvents,
  };
};

export const buildBillingActionEnvelope = async ({
  store,
  env,
  organizationId,
  role,
  status,
  message,
  handoffAttempt = null,
  handoffPurpose,
  handoffReused = false,
}: {
  store: OrganizationBillingStore;
  env: AuthRuntimeEnv;
  organizationId: string;
  role: OrganizationRole;
  status: 'succeeded' | 'processing' | 'conflict' | 'failed';
  message?: string | null;
  handoffAttempt?: OrganizationBillingOperationAttempt | null;
  handoffPurpose?: OrganizationBillingOperationPurpose;
  handoffReused?: boolean;
}) => {
  const handoff = handoffPurpose
    ? buildBillingHandoff({
        attempt: handoffAttempt,
        purpose: handoffPurpose,
        reused: handoffReused,
      })
    : null;
  return {
    status,
    message: message ?? null,
    billing: await readOrganizationBillingSummaryPayload({
      store,
      env,
      organizationId,
      role,
    }),
    handoff,
    url: handoff?.url ?? null,
  };
};
