import type { OrganizationRole } from '../../domain/booking/authorization.js';
import { buildBillingDocumentReadiness } from '../../domain/billing/reserve-app-billing-documents.js';
import type { ReserveAppBillingInvoiceEvent } from '../../domain/billing/reserve-app-billing-invoice-events.js';
import type {
  OrganizationBillingOperationAttempt,
  OrganizationBillingOperationPurpose,
} from '../../domain/billing/organization-billing-operations.js';
import { resolveReserveAppPremiumEntitlementPolicy } from '../../domain/billing/reserve-app-billing-entitlement-policy.js';
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
  type BillingApiSummaryClientResolution,
  type BillingApiOrganizationSubject,
} from './billing-api-client.js';
import { hasBillingApiPremiumEntitlement, readBillingApiSummary } from './billing-api-summary.js';
import {
  readBillingApiShadowDiagnostic,
  type BillingApiShadowClientResolution,
  type BillingApiShadowSubject,
} from './billing-api-shadow.js';
import {
  isReserveAppBillingInterval,
  isReserveAppBillingSubscriptionStatus,
  resolveReserveAppBillingPaymentIssueState,
  resolveReserveAppBillingPaymentIssueTiming,
  resolveReserveAppBillingPaymentMethodStatus,
  type ReserveAppBillingSubscriptionStatus,
} from './policies/reserve-app-billing-policy.js';
import type { ReserveAppBillingStore, ReserveAppBillingSummaryRow } from './billing.store.js';

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

const toDateOrNull = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

export const readOrganizationBillingSummaryPayload = async ({
  store,
  env,
  organizationId,
  role,
  billingApiSummary,
  billingApiSummaryResponse: providedBillingApiSummaryResponse,
  billingApiShadow,
}: {
  store: ReserveAppBillingStore;
  env: AuthRuntimeEnv;
  organizationId: string;
  role: OrganizationRole;
  billingApiSummary?: {
    clientResolution: BillingApiSummaryClientResolution;
    subject: BillingApiOrganizationSubject;
  };
  billingApiSummaryResponse?: Awaited<ReturnType<typeof readBillingApiSummary>> | null;
  billingApiShadow?: {
    clientResolution: BillingApiShadowClientResolution;
    subject: BillingApiShadowSubject;
  };
}) => {
  const billing = await store.selectSummary(organizationId);
  const billingApiSummaryResponse =
    providedBillingApiSummaryResponse ??
    (billingApiSummary
      ? await readBillingApiSummary({
          clientResolution: billingApiSummary.clientResolution,
          subject: billingApiSummary.subject,
          contactRole: 'current_billing_viewer',
          idempotencyKeyPrefix: 'reserve-summary-sync',
        })
      : null);
  const planCode: 'free' | 'premium' =
    billingApiSummaryResponse?.subscription?.planCode === 'premium' ||
    billingApiSummaryResponse?.entitlements.planCode === 'premium'
      ? 'premium'
      : billing?.planCode === 'premium'
        ? 'premium'
        : 'free';
  const billingInterval =
    isReserveAppBillingInterval(billingApiSummaryResponse?.subscription?.interval ?? null) ??
    isReserveAppBillingInterval(billing?.billingInterval ?? null);
  const subscriptionStatus =
    isReserveAppBillingSubscriptionStatus(billingApiSummaryResponse?.entitlements.status ?? null) ??
    isReserveAppBillingSubscriptionStatus(
      billingApiSummaryResponse?.subscription?.status ?? null,
    ) ??
    isReserveAppBillingSubscriptionStatus(billing?.subscriptionStatus ?? null) ??
    'free';
  const trialStartedAt =
    toIsoDateString(billingApiSummaryResponse?.subscription?.trialStart) ??
    toIsoDateString(billing?.trialStartedAt);
  const currentPeriodEnd =
    toIsoDateString(billingApiSummaryResponse?.subscription?.currentPeriodEnd) ??
    toIsoDateString(billing?.currentPeriodEnd);
  const pastDueGraceEndsAt = toIsoDateString(billing?.pastDueGraceEndsAt);
  const stripeCustomerId =
    billingApiSummaryResponse?.account.providerCustomerId ?? billing?.stripeCustomerId ?? null;
  const stripeSubscriptionId =
    billingApiSummaryResponse?.subscription?.providerSubscriptionId ??
    billing?.stripeSubscriptionId ??
    null;
  const stripePriceId =
    billingApiSummaryResponse?.subscription?.providerPriceId ?? billing?.stripePriceId ?? null;
  const cancelAtPeriodEnd =
    billingApiSummaryResponse?.subscription?.cancelAtPeriodEnd ??
    Boolean(billing?.cancelAtPeriodEnd);
  const paymentMethodStatus = await resolveReserveAppBillingPaymentMethodStatus({
    env,
    planCode,
    stripeCustomerId,
  });
  const entitlementPolicy = resolveReserveAppPremiumEntitlementPolicy({
    planCode,
    subscriptionStatus,
    paymentMethodStatus,
    currentPeriodEnd,
    pastDueGraceEndsAt,
    cancelAtPeriodEnd,
    stripePriceId,
    env,
  });
  const canManageBilling = role === 'owner';
  const trialUsed = await store.hasStartedPremiumTrial({
    organizationId,
  });
  const billingForActionAvailability: ReserveAppBillingSummaryRow = billingApiSummaryResponse
    ? {
        planCode,
        billingInterval,
        subscriptionStatus,
        cancelAtPeriodEnd,
        trialStartedAt: toDateOrNull(billingApiSummaryResponse.subscription?.trialStart),
        trialEndedAt: toDateOrNull(billingApiSummaryResponse.subscription?.trialEnd),
        currentPeriodStart: toDateOrNull(
          billingApiSummaryResponse.subscription?.currentPeriodStart,
        ),
        currentPeriodEnd: toDateOrNull(billingApiSummaryResponse.subscription?.currentPeriodEnd),
        paymentIssueStartedAt: billing?.paymentIssueStartedAt ?? null,
        pastDueGraceEndsAt: billing?.pastDueGraceEndsAt ?? null,
        billingProfileReadiness: billing?.billingProfileReadiness ?? 'not_required',
        billingProfileNextAction: billing?.billingProfileNextAction ?? null,
        billingProfileCheckedAt: billing?.billingProfileCheckedAt ?? null,
        lastReconciledAt: billing?.lastReconciledAt ?? null,
        lastReconciliationReason: billing?.lastReconciliationReason ?? null,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
      }
    : billing;
  const actionAvailability = resolveOrganizationBillingActionAvailability({
    billing: billingForActionAvailability,
    canManageBilling,
    trialUsed,
    stripeBillingConfigured: billingApiSummaryResponse
      ? billingApiSummaryResponse.provider.stripeConfigured
      : Boolean(env.STRIPE_SECRET_KEY?.trim()),
    availableIntervals: resolveBillingAvailableIntervals(env),
  });
  const billingApiPremiumEligible = billingApiSummaryResponse
    ? hasBillingApiPremiumEntitlement(billingApiSummaryResponse)
    : null;
  const premiumEligible = billingApiPremiumEligible ?? entitlementPolicy.isPremiumEligible;
  const entitlementState = premiumEligible ? 'premium_enabled' : 'free_only';
  const paidTier = premiumEligible ? entitlementPolicy.paidTier : null;
  const capabilities = paidTier?.capabilities ?? [];
  const billingApiShadowDiagnostic = billingApiShadow
    ? await readBillingApiShadowDiagnostic({
        clientResolution: billingApiShadow.clientResolution,
        subject: billingApiShadow.subject,
        legacy: {
          planCode,
          subscriptionStatus,
          entitlementState: entitlementPolicy.entitlementState,
          premiumEligible: entitlementPolicy.isPremiumEligible,
          capabilities,
        },
      })
    : null;
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
          stripeCustomerId,
          stripeSubscriptionId,
          documents: documentReferences,
        })
      : null;

  return {
    organizationId,
    planCode,
    planState: entitlementPolicy.planState,
    paidTier,
    billingInterval,
    subscriptionStatus,
    cancelAtPeriodEnd,
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
    premiumEligible,
    entitlementState,
    entitlementReason: entitlementPolicy.reason,
    capabilities,
    paymentMethodStatus,
    canViewBilling: true,
    canManageBilling,
    actionAvailability,
    billingProfileReadiness: resolveOrganizationBillingProfileReadiness(billing),
    history,
    paymentDocuments,
    invoicePaymentEvents,
    billingApiShadow: billingApiShadowDiagnostic,
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
  billingApiSummaryResponse = null,
}: {
  store: ReserveAppBillingStore;
  env: AuthRuntimeEnv;
  organizationId: string;
  role: OrganizationRole;
  status: 'succeeded' | 'processing' | 'conflict' | 'failed';
  message?: string | null;
  handoffAttempt?: OrganizationBillingOperationAttempt | null;
  handoffPurpose?: OrganizationBillingOperationPurpose;
  handoffReused?: boolean;
  billingApiSummaryResponse?: Awaited<ReturnType<typeof readBillingApiSummary>> | null;
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
      billingApiSummaryResponse,
    }),
    handoff,
    url: handoff?.url ?? null,
  };
};
