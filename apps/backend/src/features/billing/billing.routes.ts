import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import { canViewOrganizationBillingByRole } from '../../domain/booking/authorization.js';
import { readInternalBillingInspection } from '../../domain/billing/internal-billing-inspection.js';
import {
  canAccessInternalBillingInspection,
  INTERNAL_BILLING_INSPECTION_DENIED_MESSAGE,
} from '../../domain/billing/internal-operator-access.js';
import {
  BILLING_HANDOFF_REUSE_WINDOW_MS,
  createBillingOperationAttempt,
  markBillingOperationAttemptFailed,
  markBillingOperationAttemptSucceeded,
  type OrganizationBillingOperationAttempt,
  type OrganizationBillingOperationPurpose,
} from '../../domain/billing/organization-billing-operations.js';
import { buildBillingDocumentReadiness } from '../../domain/billing/organization-billing-documents.js';
import { readOrganizationOwnerBillingHistory } from '../../domain/billing/organization-billing-history.js';
import {
  readOrganizationBillingDocumentReferences,
  readOrganizationBillingInvoicePaymentEvents,
  type OrganizationBillingInvoicePaymentEvent,
} from '../../domain/billing/organization-billing-invoice-events.js';
import {
  appendOrganizationBillingAuditEvent,
  appendOrganizationBillingSignal,
  appendResolvedBillingSignalIfNeeded,
  readOrganizationBillingObservationSnapshot,
} from '../../domain/billing/organization-billing-observability.js';
import { resolveOrganizationPremiumEntitlementPolicy } from '../../domain/billing/organization-billing-policy.js';
import {
  applyOrganizationPremiumTrialCompletion,
  hasActivePremiumSubscription,
  hasOrganizationStartedPremiumTrial,
  isBillingInterval,
  isBillingSubscriptionStatus,
  ORGANIZATION_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE,
  ORGANIZATION_PREMIUM_TRIAL_DURATION_DAYS,
  resolveOrganizationBillingActionAvailability,
  resolveOrganizationBillingPaymentIssueState,
  resolveOrganizationBillingPaymentIssueTiming,
  resolveOrganizationBillingPaymentMethodStatus,
  resolveOrganizationBillingProfileReadiness,
  selectOrganizationBillingSummary,
  startOrganizationPremiumTrial,
  updateOrganizationBillingStripeCustomerId,
  type OrganizationBillingSubscriptionStatus,
} from '../../domain/billing/organization-billing.js';
import * as dbSchema from '../../infra/db/schema.js';
import { createStripeBillingProvider } from '../../infra/payment/stripe-billing-provider.js';
import {
  buildOrganizationBillingCatalog,
  listOrganizationBillingCatalogIntervals,
  resolveOrganizationBillingPriceId,
} from './billing.catalog.js';

type BillingRouteBindings = {
  Variables: {
    user: Record<string, unknown> | null;
    session: Record<string, unknown> | null;
  };
};

type RegisterBillingRoutesOptions = {
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
};

/** E2E 実行時だけ、共有 secret 付き header から Stripe test clock id を受け取る。 */
export const resolveE2eStripeTestClockId = ({
  env,
  headers,
}: {
  env: { E2E_TESTING_ENABLED?: string; E2E_TEST_SECRET?: string };
  headers: Headers;
}): string | null => {
  if (env.E2E_TESTING_ENABLED !== 'true') {
    return null;
  }

  const expectedSecret = env.E2E_TEST_SECRET?.trim();
  if (!expectedSecret) {
    return null;
  }

  const receivedSecret = headers.get('x-e2e-test-secret')?.trim();
  if (receivedSecret !== expectedSecret) {
    return null;
  }

  const testClockId = headers.get('x-e2e-stripe-test-clock-id')?.trim();
  return testClockId?.startsWith('clock_') ? testClockId : null;
};

const getActiveOrganizationId = (session: unknown): string | null => {
  if (typeof session !== 'object' || session === null) {
    return null;
  }

  const currentSession = session as Record<string, unknown>;
  const activeOrganizationId = currentSession.activeOrganizationId;
  return typeof activeOrganizationId === 'string' ? activeOrganizationId : null;
};

const getStringValue = (value: unknown): string | null => {
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const organizationBillingQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

const organizationBillingCheckoutBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  billingInterval: z.enum(['month', 'year']),
});

const organizationBillingPortalBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

const organizationBillingTrialBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

const organizationBillingPaymentMethodBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

const organizationBillingTrialCompletionBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

const internalBillingInspectionParamsSchema = z.object({
  organizationId: z.string().min(1),
});

const organizationBillingPaidTierSchema = z.object({
  code: z.enum(['premium_default', 'premium_growth', 'premium_scale', 'premium_unknown']),
  label: z.string().min(1),
  resolution: z.enum(['not_paid', 'legacy_default', 'known_price', 'unknown_price']),
  capabilities: z.array(
    z.enum(['organization_premium_features', 'advanced_billing_communications']),
  ),
  diagnosticReason: z.string().nullable(),
});

const organizationBillingActionAvailabilitySchema = z.object({
  canStartTrial: z.boolean(),
  canStartPaidCheckout: z.boolean(),
  canRegisterPaymentMethod: z.boolean(),
  canOpenBillingPortal: z.boolean(),
  trialUsed: z.boolean(),
  availableIntervals: z.array(z.enum(['month', 'year'])),
  nextOwnerAction: z.string().nullable(),
  readOnlyReason: z.string().nullable(),
});

const organizationBillingProfileReadinessSchema = z.object({
  state: z.enum(['complete', 'incomplete', 'unavailable', 'not_required']),
  nextAction: z.string().nullable(),
  checkedAt: z.string().nullable(),
  gatesCheckout: z.literal(false),
  gatesPremiumEligibility: z.literal(false),
});

const organizationBillingInvoicePaymentEventSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  stripeEventId: z.string().nullable(),
  eventType: z.enum([
    'invoice_available',
    'payment_succeeded',
    'payment_failed',
    'payment_action_required',
  ]),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  stripeInvoiceId: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  providerStatus: z.string().nullable(),
  ownerFacingStatus: z.enum([
    'available',
    'checking',
    'missing',
    'action_required',
    'failed',
    'succeeded',
  ]),
  occurredAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});

const organizationBillingPaymentIssueStateSchema = z.enum([
  'none',
  'payment_failed',
  'payment_action_required',
  'past_due_grace_active',
  'past_due_grace_expired',
  'unpaid',
  'incomplete',
  'recovered',
  'stale_failure_history_only',
]);

const organizationBillingPaymentIssueTimingSchema = z.object({
  issueStartedAt: z.string().nullable(),
  issueStartedAtSource: z.enum(['provider_issue_time', 'application_receipt_time', 'none']),
  graceEndsAt: z.string().nullable(),
});

const organizationBillingSummarySchema = z.object({
  organizationId: z.string().min(1),
  planCode: z.enum(['free', 'premium']),
  planState: z.enum(['free', 'premium_trial', 'premium_paid']),
  billingInterval: z.enum(['month', 'year']).nullable(),
  subscriptionStatus: z
    .enum(['free', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete'])
    .nullable(),
  cancelAtPeriodEnd: z.boolean(),
  trialStartedAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  paymentIssueStartedAt: z.string().nullable(),
  pastDueGraceEndsAt: z.string().nullable(),
  paymentIssueState: organizationBillingPaymentIssueStateSchema,
  paymentIssueTiming: organizationBillingPaymentIssueTimingSchema,
  nextOwnerAction: z.string().nullable(),
  lastReconciledAt: z.string().nullable(),
  lastReconciliationReason: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  premiumEligible: z.boolean(),
  entitlementState: z.enum(['free_only', 'premium_enabled']),
  entitlementReason: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
  paymentMethodStatus: z.enum(['not_started', 'pending', 'registered']),
  paidTier: organizationBillingPaidTierSchema.nullable(),
  canViewBilling: z.boolean(),
  canManageBilling: z.boolean(),
  actionAvailability: organizationBillingActionAvailabilitySchema,
  billingProfileReadiness: organizationBillingProfileReadinessSchema,
  history: z
    .array(
      z.object({
        id: z.string().min(1),
        eventType: z.enum(['plan_transition', 'notification', 'reconciliation', 'payment_event']),
        occurredAt: z.string().nullable(),
        title: z.string().min(1),
        summary: z.string().min(1),
        billingContext: z.string().nullable(),
        tone: z.enum(['neutral', 'positive', 'attention']),
      }),
    )
    .nullable(),
  paymentDocuments: z
    .object({
      aggregateRoot: z.literal('organization_billing'),
      organizationId: z.string().min(1),
      provider: z.literal('stripe'),
      stripeCustomerId: z.string().nullable(),
      stripeSubscriptionId: z.string().nullable(),
      ownerAccess: z.literal('owner_only'),
      persistenceStrategy: z.literal('provider_reference_only'),
      documents: z.array(
        z.object({
          documentKind: z.enum(['invoice', 'receipt']),
          providerDocumentId: z.string().min(1),
          hostedInvoiceUrl: z.string().url().nullable(),
          invoicePdfUrl: z.string().url().nullable(),
          receiptUrl: z.string().url().nullable(),
          availability: z.enum(['available', 'unavailable', 'missing', 'checking']),
          ownerFacingStatus: z.enum(['available', 'unavailable', 'checking']),
          providerDerived: z.boolean().optional(),
        }),
      ),
    })
    .nullable(),
  invoicePaymentEvents: z.array(organizationBillingInvoicePaymentEventSchema),
});

const organizationBillingHandoffSchema = z.object({
  provider: z.literal('stripe'),
  purpose: z.enum(['trial_start', 'paid_checkout', 'payment_method_setup', 'billing_portal']),
  url: z.string().url(),
  expiresAt: z.string(),
  reused: z.boolean(),
  operationAttemptId: z.string().min(1).optional(),
});

const organizationBillingActionResponseSchema = z.object({
  status: z.enum(['succeeded', 'processing', 'conflict', 'failed']),
  message: z.string().nullable(),
  billing: organizationBillingSummarySchema.nullable(),
  handoff: organizationBillingHandoffSchema.nullable(),
  url: z.string().url().nullable().optional(),
});
const organizationBillingActionOrMessageResponseSchema = z.union([
  organizationBillingActionResponseSchema,
  z.object({ message: z.string().min(1) }),
]);

const internalBillingInspectionSummarySchema = z.object({
  planCode: z.enum(['free', 'premium']),
  planState: z.enum(['free', 'premium_trial', 'premium_paid']),
  lifecycleStage: z.enum(['free', 'trial', 'paid']),
  lifecycleReason: z.string().min(1),
  entitlementState: z.enum(['free_only', 'premium_enabled']),
  billingInterval: z.enum(['month', 'year']).nullable(),
  subscriptionStatus: z.enum([
    'free',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'incomplete',
  ]),
  paymentMethodStatus: z.enum(['not_started', 'pending', 'registered']),
  currentPeriodEnd: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  stripeLinked: z.boolean(),
  paidTier: organizationBillingPaidTierSchema.nullable(),
  billingProfileReadiness: organizationBillingProfileReadinessSchema,
});

const internalBillingInspectionProviderSchema = z.object({
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  stripePriceId: z.string().nullable(),
  providerPlanState: z.enum(['free', 'premium_trial', 'premium_paid']).nullable(),
  providerSubscriptionStatus: z
    .enum(['free', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete'])
    .nullable(),
  paymentMethodStatus: z.enum(['not_started', 'pending', 'registered']),
  paidTier: organizationBillingPaidTierSchema.nullable(),
});

const internalBillingInspectionLifecycleEventSchema = z.object({
  sequenceNumber: z.number().int().nonnegative(),
  sourceKind: z.string().min(1),
  sourceContext: z.string().nullable(),
  createdAt: z.string().nullable(),
  transition: z.object({
    previousPlanState: z.string().min(1),
    nextPlanState: z.string().min(1),
    previousSubscriptionStatus: z.string().min(1),
    nextSubscriptionStatus: z.string().min(1),
    previousPaymentMethodStatus: z.string().min(1),
    nextPaymentMethodStatus: z.string().min(1),
    previousEntitlementState: z.string().min(1),
    nextEntitlementState: z.string().min(1),
  }),
});

const internalBillingInspectionSignalSchema = z.object({
  sequenceNumber: z.number().int().nonnegative(),
  signalKind: z.string().min(1),
  signalStatus: z.string().min(1),
  sourceKind: z.string().min(1),
  reason: z.string().min(1),
  providerPlanState: z.enum(['free', 'premium_trial', 'premium_paid']).nullable(),
  providerSubscriptionStatus: z
    .enum(['free', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete'])
    .nullable(),
  createdAt: z.string().nullable(),
});

const internalBillingInspectionReconciliationCurrentComparisonSchema = z.object({
  providerPlanState: z.enum(['free', 'premium_trial', 'premium_paid']).nullable(),
  providerSubscriptionStatus: z
    .enum(['free', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete'])
    .nullable(),
  appPlanState: z.enum(['free', 'premium_trial', 'premium_paid']),
  appSubscriptionStatus: z.enum([
    'free',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'incomplete',
  ]),
  appPaymentMethodStatus: z.enum(['not_started', 'pending', 'registered']),
  appEntitlementState: z.enum(['free_only', 'premium_enabled']),
});

const internalBillingInspectionReconciliationSignalSchema = z.object({
  sequenceNumber: z.number().int().nonnegative(),
  signalStatus: z.enum(['pending', 'mismatch', 'unavailable', 'resolved']),
  sourceKind: z.string().min(1),
  reason: z.string().min(1),
  stripeEventId: z.string().min(1).nullable(),
  providerPlanState: z.enum(['free', 'premium_trial', 'premium_paid']).nullable(),
  providerSubscriptionStatus: z
    .enum(['free', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete'])
    .nullable(),
  appPlanState: z.enum(['free', 'premium_trial', 'premium_paid']),
  appSubscriptionStatus: z.enum([
    'free',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'incomplete',
  ]),
  appPaymentMethodStatus: z.enum(['not_started', 'pending', 'registered']),
  appEntitlementState: z.enum(['free_only', 'premium_enabled']),
  createdAt: z.string().nullable(),
});

const internalBillingInspectionReconciliationWebhookEventSchema = z.object({
  id: z.string().min(1),
  eventType: z.string().min(1),
  processingStatus: z.enum(['processing', 'processed', 'failed']),
  failureReason: z.string().min(1).nullable(),
  signatureVerificationStatus: z.string().min(1),
  duplicateDetected: z.boolean(),
  duplicateDetectedAt: z.string().nullable(),
  receiptStatus: z.string().min(1),
  createdAt: z.string().nullable(),
  processedAt: z.string().nullable(),
});

const internalBillingInspectionReconciliationWebhookFailureSchema = z.object({
  eventId: z.string().min(1).nullable(),
  eventType: z.string().min(1).nullable(),
  failureStage: z.string().min(1),
  failureReason: z.string().min(1),
  createdAt: z.string().nullable(),
});

const internalBillingInspectionReconciliationSchema = z.object({
  status: z.enum(['not_applicable', 'aligned', 'mismatch', 'pending', 'unavailable', 'incomplete']),
  comparable: z.boolean(),
  latestSignalStatus: z.enum(['pending', 'mismatch', 'unavailable', 'resolved']).nullable(),
  latestSignalReason: z.string().min(1).nullable(),
  currentComparison: internalBillingInspectionReconciliationCurrentComparisonSchema,
  recentSignals: z.array(internalBillingInspectionReconciliationSignalSchema),
  recentWebhookEvents: z.array(internalBillingInspectionReconciliationWebhookEventSchema),
  recentWebhookFailures: z.array(internalBillingInspectionReconciliationWebhookFailureSchema),
});

const internalBillingInspectionNotificationHistoryEntrySchema = z.object({
  sequenceNumber: z.number().int().nonnegative(),
  notificationKind: z.enum([
    'trial_will_end_email',
    'trial_will_end',
    'payment_failed_email',
    'payment_action_required_email',
    'past_due_grace_reminder_email',
    'unknown',
  ]),
  communicationType: z.enum(['trial_will_end', 'payment_issue', 'unknown']),
  channel: z.enum(['email', 'in_app', 'web_push', 'unknown']),
  channelLabel: z.string().min(1),
  deliveryState: z.enum(['requested', 'retried', 'sent', 'failed', 'skipped', 'unknown']),
  deliveryOutcome: z.enum(['pending', 'delivered', 'failed', 'unknown']),
  attemptNumber: z.number().int().positive(),
  stripeEventId: z.string().min(1).nullable(),
  recipientEmail: z.string().min(1).nullable(),
  planState: z.enum(['free', 'premium_trial', 'premium_paid']),
  subscriptionStatus: z.enum([
    'free',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'incomplete',
  ]),
  paymentMethodStatus: z.enum(['not_started', 'pending', 'registered']),
  trialEndsAt: z.string().nullable(),
  failureReason: z.string().min(1).nullable(),
  createdAt: z.string().nullable(),
});

const internalBillingInspectionReminderDeliverySchema = z.object({
  status: z.enum(['not_expected', 'missing', 'pending', 'delivered', 'failed', 'unknown']),
  expected: z.boolean(),
  eventFound: z.boolean(),
  outcomeKnown: z.boolean(),
  latestEventId: z.string().min(1).nullable(),
  latestEventProcessingStatus: z.enum(['processing', 'processed', 'failed']).nullable(),
  latestEventAt: z.string().nullable(),
  latestSignalStatus: z.enum(['pending', 'mismatch', 'unavailable', 'resolved']).nullable(),
  latestSignalReason: z.string().min(1).nullable(),
  latestFailureReason: z.string().min(1).nullable(),
  history: z.array(internalBillingInspectionNotificationHistoryEntrySchema),
});

const internalBillingInspectionNotificationsSchema = z.object({
  reminderDelivery: internalBillingInspectionReminderDeliverySchema,
});

const internalPaymentIssueNotificationRecipientSchema = z.object({
  recipientUserId: z.string().min(1).nullable(),
  recipientEmail: z.string().min(1).nullable(),
  deliveryState: z.enum(['requested', 'retried', 'sent', 'failed', 'skipped']),
  retryEligible: z.boolean(),
  failureReason: z.string().min(1).nullable(),
});

const internalPaymentIssueSupportSignalSchema = z.object({
  reason: z.string().min(1),
  status: z.string().min(1),
});

const internalPaymentIssueInspectionSchema = z.object({
  paymentIssueState: organizationBillingPaymentIssueStateSchema,
  notificationRecipients: z.array(internalPaymentIssueNotificationRecipientSchema),
  staleFailureEvents: z.array(organizationBillingInvoicePaymentEventSchema),
  supportSignals: z.array(internalPaymentIssueSupportSignalSchema),
});

const internalBillingInspectionPaymentDocumentsSchema = z.object({
  aggregateRoot: z.literal('organization_billing'),
  provider: z.literal('stripe'),
  ownerAccess: z.literal('owner_only'),
  persistenceStrategy: z.literal('provider_reference_only'),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  diagnosticReason: z.string().min(1).nullable(),
  documents: z.array(
    z.object({
      documentKind: z.enum(['invoice', 'receipt']),
      providerDocumentId: z.string().min(1),
      hostedInvoiceUrl: z.string().url().nullable(),
      invoicePdfUrl: z.string().url().nullable(),
      receiptUrl: z.string().url().nullable(),
      availability: z.enum(['available', 'unavailable', 'missing', 'checking']),
      ownerFacingStatus: z.enum(['available', 'unavailable', 'checking']),
      providerDerived: z.boolean(),
    }),
  ),
});

const internalBillingInspectionOperationAttemptSchema = z.object({
  id: z.string().min(1),
  purpose: z.enum(['trial_start', 'paid_checkout', 'payment_method_setup', 'billing_portal']),
  billingInterval: z.enum(['month', 'year']).nullable(),
  state: z.enum(['processing', 'succeeded', 'conflict', 'expired', 'failed']),
  handoffExpiresAt: z.string().nullable(),
  provider: z.literal('stripe'),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  stripeCheckoutSessionId: z.string().nullable(),
  stripePortalSessionId: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const internalBillingInspectionTimelineEntrySchema = z.object({
  id: z.string().min(1),
  lane: z.enum(['billing_state', 'reconciliation', 'notification', 'provider_webhook']),
  entryType: z.enum(['audit_event', 'signal', 'notification', 'webhook_event', 'webhook_failure']),
  occurredAt: z.string().nullable(),
  headline: z.string().min(1),
  summary: z.string().min(1),
  notificationKind: z.string().min(1).nullable(),
  communicationType: z.enum(['trial_will_end', 'payment_issue', 'unknown']).nullable(),
  notificationChannel: z.enum(['email', 'in_app', 'web_push', 'unknown']).nullable(),
  notificationChannelLabel: z.string().min(1).nullable(),
  sequenceNumber: z.number().int().nonnegative().nullable(),
  stripeEventId: z.string().min(1).nullable(),
  sourceKind: z.string().min(1).nullable(),
  signalKind: z
    .enum(['reconciliation', 'notification_delivery', 'billing_profile', 'security_audit'])
    .nullable(),
  signalStatus: z.enum(['pending', 'mismatch', 'unavailable', 'resolved']).nullable(),
  deliveryState: z
    .enum(['requested', 'retried', 'sent', 'failed', 'skipped', 'unknown'])
    .nullable(),
  webhookEventType: z.string().min(1).nullable(),
  webhookProcessingStatus: z.enum(['processing', 'processed', 'failed']).nullable(),
  webhookFailureStage: z.string().min(1).nullable(),
});

const internalBillingInspectionTimelineSchema = z.object({
  entries: z.array(internalBillingInspectionTimelineEntrySchema),
});

const internalBillingInspectionResponseSchema = z.object({
  organizationId: z.string().min(1),
  organizationName: z.string().min(1),
  organizationSlug: z.string().min(1),
  summary: internalBillingInspectionSummarySchema,
  provider: internalBillingInspectionProviderSchema.nullable(),
  lifecycle: z.object({
    recentEvents: z.array(internalBillingInspectionLifecycleEventSchema),
    latestSignal: internalBillingInspectionSignalSchema.nullable(),
  }),
  reconciliation: internalBillingInspectionReconciliationSchema,
  notifications: internalBillingInspectionNotificationsSchema,
  paymentIssue: internalPaymentIssueInspectionSchema,
  paymentDocuments: internalBillingInspectionPaymentDocumentsSchema,
  invoicePaymentEvents: z.array(organizationBillingInvoicePaymentEventSchema),
  operationAttempts: z.array(internalBillingInspectionOperationAttemptSchema),
  timeline: internalBillingInspectionTimelineSchema,
});

const getOrganizationBillingRoute = createRoute({
  method: 'get',
  path: '/organizations/billing',
  tags: ['Organization Billing'],
  summary: 'Get active organization billing summary',
  request: {
    query: organizationBillingQuerySchema,
  },
  responses: {
    200: {
      description: 'Organization billing summary',
      content: {
        'application/json': {
          schema: organizationBillingSummarySchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    422: {
      description: 'organizationId is required',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
  },
});

const createOrganizationBillingCheckoutRoute = createRoute({
  method: 'post',
  path: '/organizations/billing/checkout',
  tags: ['Organization Billing'],
  summary: 'Create Stripe Checkout URL for premium subscription',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: organizationBillingCheckoutBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Stripe Checkout URL',
      content: {
        'application/json': {
          schema: organizationBillingActionResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    409: {
      description: 'Organization already has an active premium subscription',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
    422: {
      description: 'Stripe billing is not configured',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
    500: {
      description: 'Stripe checkout creation failed',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
  },
});

const createOrganizationBillingPortalRoute = createRoute({
  method: 'post',
  path: '/organizations/billing/portal',
  tags: ['Organization Billing'],
  summary: 'Create Stripe Customer Portal URL for current premium subscription',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: organizationBillingPortalBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Stripe Customer Portal URL',
      content: {
        'application/json': {
          schema: organizationBillingActionResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    409: {
      description: 'Organization does not have a premium subscription',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
    422: {
      description: 'Stripe billing is not configured',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
    500: {
      description: 'Stripe portal creation failed',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
  },
});

const createOrganizationBillingTrialRoute = createRoute({
  method: 'post',
  path: '/organizations/billing/trial',
  tags: ['Organization Billing'],
  summary: 'Start a 7-day premium trial for the active organization',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: organizationBillingTrialBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Premium trial started',
      content: {
        'application/json': {
          schema: organizationBillingActionResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    409: {
      description: 'Organization already has an active premium lifecycle',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
    422: {
      description: 'organizationId is required',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
    500: {
      description: 'Premium trial start failed',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
  },
});

const createOrganizationBillingPaymentMethodRoute = createRoute({
  method: 'post',
  path: '/organizations/billing/payment-method',
  tags: ['Organization Billing'],
  summary: 'Create Stripe setup handoff URL for organization payment method registration',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: organizationBillingPaymentMethodBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Stripe setup checkout URL',
      content: {
        'application/json': {
          schema: organizationBillingActionResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    409: {
      description: 'Organization does not have an active premium trial',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
    422: {
      description: 'Stripe billing is not configured',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
    500: {
      description: 'Stripe setup checkout creation failed',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
  },
});

const createOrganizationBillingTrialCompletionRoute = createRoute({
  method: 'post',
  path: '/organizations/billing/trial/complete',
  tags: ['Organization Billing'],
  summary: 'Evaluate and apply premium trial completion lifecycle rules',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: organizationBillingTrialCompletionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Trial lifecycle transition applied',
      content: {
        'application/json': {
          schema: organizationBillingActionResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    409: {
      description: 'Organization does not have a completeable premium trial',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
    422: {
      description: 'Stripe billing is not configured',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
    503: {
      description: 'Stripe payment method reflection is still syncing',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
  },
});

const getInternalBillingInspectionRoute = createRoute({
  method: 'get',
  path: '/internal/organizations/{organizationId}/billing-inspection',
  tags: ['Internal Billing'],
  summary: 'Get internal read-only billing inspection view for an organization',
  request: {
    params: internalBillingInspectionParamsSchema,
  },
  responses: {
    200: {
      description: 'Internal billing inspection view',
      content: {
        'application/json': {
          schema: internalBillingInspectionResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    403: {
      description: 'Internal billing inspection access denied.',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
    404: {
      description: 'Organization not found',
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
    },
  },
});

const toIsoDateString = (value: unknown): string | null => {
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

const toTimestamp = (value: unknown): number | null => {
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

const getPaymentEventTime = (event: OrganizationBillingInvoicePaymentEvent) =>
  toTimestamp(event.occurredAt) ?? toTimestamp(event.createdAt);

const resolveOrganizationId = (
  requestedOrganizationId: string | undefined,
  activeOrganizationId: string | null,
) => {
  return requestedOrganizationId ?? activeOrganizationId;
};

const buildBillingHandoff = ({
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

const toBillingOperationFailureMessage = (error: unknown, fallbackMessage: string): string => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return fallbackMessage;
};

export const registerBillingRoutes = (
  authRoutes: OpenAPIHono<BillingRouteBindings>,
  { auth, database, env }: RegisterBillingRoutesOptions,
) => {
  const getSessionIdentity = async (
    headers: Headers,
  ): Promise<{
    userId: string;
    email: string | null;
    emailVerified: boolean;
    activeOrganizationId: string | null;
  } | null> => {
    const session = await auth.api.getSession({ headers });
    const userId = getStringValue(session?.user?.id);
    if (!userId) {
      return null;
    }

    const userEmail = getStringValue(session?.user?.email);
    return {
      userId,
      email: userEmail ? normalizeEmail(userEmail) : null,
      emailVerified: session?.user?.emailVerified === true,
      activeOrganizationId: getActiveOrganizationId(session?.session),
    };
  };

  const readOrganizationMembershipRole = async ({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<'owner' | 'admin' | 'member' | null> => {
    const rows = await database
      .select({
        role: dbSchema.member.role,
      })
      .from(dbSchema.member)
      .where(
        and(eq(dbSchema.member.organizationId, organizationId), eq(dbSchema.member.userId, userId)),
      )
      .limit(1);

    const role = rows[0]?.role;
    if (role === 'owner' || role === 'admin' || role === 'member') {
      return role;
    }
    return null;
  };

  const resolveDefaultPremiumTrialPriceConfig = (): {
    priceId: string;
    billingInterval: 'month' | 'year';
  } | null => {
    if (env.STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED !== 'true') {
      return null;
    }

    const catalogResult = buildOrganizationBillingCatalog(env);
    const monthlyPrice = resolveOrganizationBillingPriceId({
      catalogResult,
      interval: 'month',
    });
    if (monthlyPrice.ok) {
      return {
        priceId: monthlyPrice.priceId,
        billingInterval: 'month',
      };
    }

    const yearlyPrice = resolveOrganizationBillingPriceId({
      catalogResult,
      interval: 'year',
    });
    if (yearlyPrice.ok) {
      return {
        priceId: yearlyPrice.priceId,
        billingInterval: 'year',
      };
    }

    return null;
  };

  const resolveBillingAvailableIntervals = (): Array<'month' | 'year'> => {
    return listOrganizationBillingCatalogIntervals(buildOrganizationBillingCatalog(env));
  };

  const resolvePaymentIssueContext = ({
    subscriptionStatus,
    entitlementReason,
    paymentIssueStartedAt,
    pastDueGraceEndsAt,
    invoicePaymentEvents,
  }: {
    subscriptionStatus: OrganizationBillingSubscriptionStatus;
    entitlementReason: string;
    paymentIssueStartedAt: unknown;
    pastDueGraceEndsAt: unknown;
    invoicePaymentEvents: OrganizationBillingInvoicePaymentEvent[];
  }) => {
    const latestIssueEvent = invoicePaymentEvents.find(
      (
        event,
      ): event is OrganizationBillingInvoicePaymentEvent & {
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
      paymentIssueState: resolveOrganizationBillingPaymentIssueState({
        subscriptionStatus,
        entitlementReason,
        latestPaymentIssueEventType,
        hasRecoveredPaymentIssueHistory,
        hasStaleFailureHistory,
      }),
      paymentIssueTiming: resolveOrganizationBillingPaymentIssueTiming({
        paymentIssueStartedAt: toIsoDateString(paymentIssueStartedAt),
        pastDueGraceEndsAt: toIsoDateString(pastDueGraceEndsAt),
        providerIssueStartedAt: latestIssueEvent?.occurredAt ?? null,
      }),
    };
  };

  const readOrganizationBillingSummaryPayload = async ({
    organizationId,
    role,
  }: {
    organizationId: string;
    role: 'owner' | 'admin' | 'member' | null;
  }) => {
    const billing = await selectOrganizationBillingSummary(database, organizationId);
    const planCode: 'free' | 'premium' = billing?.planCode === 'premium' ? 'premium' : 'free';
    const billingInterval = isBillingInterval(billing?.billingInterval ?? null);
    const subscriptionStatus =
      isBillingSubscriptionStatus(billing?.subscriptionStatus ?? null) ?? 'free';
    const trialStartedAt = toIsoDateString(billing?.trialStartedAt);
    const currentPeriodEnd = toIsoDateString(billing?.currentPeriodEnd);
    const pastDueGraceEndsAt = toIsoDateString(billing?.pastDueGraceEndsAt);
    const paymentMethodStatus = await resolveOrganizationBillingPaymentMethodStatus({
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
    const trialUsed = await hasOrganizationStartedPremiumTrial({
      database,
      organizationId,
    });
    const actionAvailability = resolveOrganizationBillingActionAvailability({
      billing,
      canManageBilling,
      trialUsed,
      stripeBillingConfigured: Boolean(env.STRIPE_SECRET_KEY?.trim()),
      availableIntervals: resolveBillingAvailableIntervals(),
    });
    const invoicePaymentEventsForContext = await readOrganizationBillingInvoicePaymentEvents({
      database,
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
            readOrganizationOwnerBillingHistory({
              database,
              organizationId,
            }).then((result) => result.entries),
            readOrganizationBillingDocumentReferences({
              database,
              organizationId,
            }),
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

  const buildBillingActionEnvelope = async ({
    organizationId,
    role,
    status,
    message,
    handoffAttempt = null,
    handoffPurpose,
    handoffReused = false,
  }: {
    organizationId: string;
    role: 'owner' | 'admin' | 'member' | null;
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
        organizationId,
        role,
      }),
      handoff,
      url: handoff?.url ?? null,
    };
  };

  authRoutes.openapi(getOrganizationBillingRoute, (c) => {
    return (async () => {
      const query = c.req.valid('query');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organizationId = resolveOrganizationId(
        query.organizationId,
        identity.activeOrganizationId,
      );
      if (!organizationId) {
        return c.json({ message: 'organizationId is required.' }, 422);
      }

      const role = await readOrganizationMembershipRole({
        organizationId,
        userId: identity.userId,
      });
      if (!canViewOrganizationBillingByRole(role)) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      return c.json(
        await readOrganizationBillingSummaryPayload({
          organizationId,
          role,
        }),
        200,
      );
    })();
  });

  authRoutes.openapi(createOrganizationBillingCheckoutRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organizationId = resolveOrganizationId(
        body.organizationId,
        identity.activeOrganizationId,
      );
      if (!organizationId) {
        return c.json({ message: 'organizationId is required.' }, 422);
      }

      const role = await readOrganizationMembershipRole({
        organizationId,
        userId: identity.userId,
      });
      if (role !== 'owner') {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const resolvedPrice = resolveOrganizationBillingPriceId({
        catalogResult: buildOrganizationBillingCatalog(env),
        interval: body.billingInterval,
      });
      if (!env.STRIPE_SECRET_KEY?.trim() || !resolvedPrice.ok) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'failed',
            message: resolvedPrice.ok
              ? 'Stripe billing is not configured.'
              : resolvedPrice.error.message,
          }),
          422,
        );
      }

      const billing = await selectOrganizationBillingSummary(database, organizationId);
      if (
        billing &&
        hasActivePremiumSubscription(isBillingSubscriptionStatus(billing.subscriptionStatus))
      ) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'conflict',
            message: 'Organization already has an active premium subscription.',
          }),
          409,
        );
      }

      const now = new Date();
      const operation = await createBillingOperationAttempt({
        database,
        organizationId,
        purpose: 'paid_checkout',
        billingInterval: body.billingInterval,
        createdByUserId: identity.userId,
        now,
      });
      if (operation.reused && operation.attempt.handoffUrl) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: operation.attempt.state === 'succeeded' ? 'succeeded' : 'processing',
            message: 'Reusing the active Stripe Checkout handoff.',
            handoffAttempt: operation.attempt,
            handoffPurpose: 'paid_checkout',
            handoffReused: true,
          }),
          200,
        );
      }
      if (operation.reused) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'conflict',
            message: 'Billing operation is already processing. Please retry shortly.',
          }),
          409,
        );
      }

      const webBaseUrl = (env.WEB_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
      const contractsUrl = `${webBaseUrl}/admin/contracts`;
      try {
        const provider = createStripeBillingProvider({ env });
        let stripeCustomerId = billing?.stripeCustomerId ?? null;
        if (!stripeCustomerId) {
          const previousBillingSnapshot = await readOrganizationBillingObservationSnapshot({
            database,
            env,
            organizationId,
          });
          const customer = await provider.createCustomer({
            idempotencyKey: `${operation.attempt.idempotencyKey}:customer`,
            metadata: {
              billingPurpose: 'organization_plan',
              organizationId,
              billingOperationAttemptId: operation.attempt.id,
            },
          });
          stripeCustomerId = customer.id;
          await updateOrganizationBillingStripeCustomerId({
            database,
            organizationId,
            stripeCustomerId,
          });
          const nextBillingSnapshot = await readOrganizationBillingObservationSnapshot({
            database,
            env,
            organizationId,
          });
          await appendOrganizationBillingAuditEvent({
            database,
            organizationId,
            sourceKind: 'paid_checkout_started',
            previousSnapshot: previousBillingSnapshot,
            nextSnapshot: nextBillingSnapshot,
            sourceContext: 'stripe_customer_created_for_paid_checkout',
          });
        }

        const session = await provider.createSubscriptionCheckoutSession({
          priceId: resolvedPrice.priceId,
          successUrl: `${contractsUrl}?subscription=success`,
          cancelUrl: `${contractsUrl}?subscription=cancel`,
          customerId: stripeCustomerId,
          idempotencyKey: operation.attempt.idempotencyKey,
          metadata: {
            billingPurpose: 'organization_plan',
            organizationId,
            planCode: 'premium',
            billingInterval: body.billingInterval,
            billingOperationAttemptId: operation.attempt.id,
          },
        });
        const succeededAttempt = await markBillingOperationAttemptSucceeded({
          database,
          attemptId: operation.attempt.id,
          handoffUrl: session.url,
          handoffExpiresAt: new Date(now.getTime() + BILLING_HANDOFF_REUSE_WINDOW_MS),
          stripeCustomerId,
          stripeCheckoutSessionId: session.id,
        });

        await appendOrganizationBillingAuditEvent({
          database,
          organizationId,
          sourceKind: 'paid_checkout_started',
          previousSnapshot: await readOrganizationBillingObservationSnapshot({
            database,
            env,
            organizationId,
          }),
          nextSnapshot: await readOrganizationBillingObservationSnapshot({
            database,
            env,
            organizationId,
          }),
          sourceContext: 'owner_started_paid_checkout_handoff',
        });

        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'processing',
            message: 'Stripe Checkout handoff is ready.',
            handoffAttempt: succeededAttempt,
            handoffPurpose: 'paid_checkout',
            handoffReused: false,
          }),
          200,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Stripe Checkout creation failed.';
        await markBillingOperationAttemptFailed({
          database,
          attemptId: operation.attempt.id,
          failureReason: message,
        });
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'failed',
            message,
          }),
          500,
        );
      }
    })();
  });

  authRoutes.openapi(createOrganizationBillingTrialRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organizationId = resolveOrganizationId(
        body.organizationId,
        identity.activeOrganizationId,
      );
      if (!organizationId) {
        return c.json({ message: 'organizationId is required.' }, 422);
      }

      const role = await readOrganizationMembershipRole({
        organizationId,
        userId: identity.userId,
      });
      if (role !== 'owner') {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const billing = await selectOrganizationBillingSummary(database, organizationId);
      if (
        billing &&
        hasActivePremiumSubscription(isBillingSubscriptionStatus(billing.subscriptionStatus))
      ) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'conflict',
            message: ORGANIZATION_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE,
          }),
          409,
        );
      }
      if (
        await hasOrganizationStartedPremiumTrial({
          database,
          organizationId,
        })
      ) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'conflict',
            message: ORGANIZATION_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE,
          }),
          409,
        );
      }

      const shouldCreateStripeTrialSubscription =
        env.STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED === 'true';
      const defaultTrialPrice = resolveDefaultPremiumTrialPriceConfig();
      if (
        shouldCreateStripeTrialSubscription &&
        env.STRIPE_SECRET_KEY?.trim() &&
        !defaultTrialPrice
      ) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'failed',
            message: 'Stripe premium trial price id is not configured.',
          }),
          422,
        );
      }

      const operation = await createBillingOperationAttempt({
        database,
        organizationId,
        purpose: 'trial_start',
        createdByUserId: identity.userId,
      });
      if (operation.reused) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'conflict',
            message: 'Billing operation is already processing. Please retry shortly.',
          }),
          409,
        );
      }
      try {
        const previousBillingSnapshot = await readOrganizationBillingObservationSnapshot({
          database,
          env,
          organizationId,
        });
        const e2eStripeTestClockId = resolveE2eStripeTestClockId({
          env,
          headers: c.req.raw.headers,
        });
        let stripeCustomerId = billing?.stripeCustomerId ?? null;
        let stripeSubscriptionId: string | null = null;
        let stripePriceId: string | null = null;
        let billingInterval: 'month' | 'year' | null = null;
        let trialStartedAt: Date | undefined;
        let trialEndsAt: Date | undefined;

        if (env.STRIPE_SECRET_KEY?.trim() && defaultTrialPrice) {
          const provider = createStripeBillingProvider({
            env,
            testClockId: e2eStripeTestClockId,
          });
          if (!stripeCustomerId) {
            const customer = await provider.createCustomer({
              idempotencyKey: `${operation.attempt.idempotencyKey}:customer`,
              metadata: {
                billingPurpose: 'organization_trial',
                organizationId,
                billingOperationAttemptId: operation.attempt.id,
              },
            });
            stripeCustomerId = customer.id;
          }

          const subscription = await provider.createTrialSubscription({
            customerId: stripeCustomerId,
            priceId: defaultTrialPrice.priceId,
            trialDays: ORGANIZATION_PREMIUM_TRIAL_DURATION_DAYS,
            idempotencyKey: operation.attempt.idempotencyKey,
            metadata: {
              billingPurpose: 'organization_plan',
              organizationId,
              planCode: 'premium',
              billingInterval: defaultTrialPrice.billingInterval,
              billingOperationAttemptId: operation.attempt.id,
            },
          });
          stripeSubscriptionId = subscription.id;
          stripePriceId = subscription.priceId ?? defaultTrialPrice.priceId;
          billingInterval = defaultTrialPrice.billingInterval;
          trialStartedAt = subscription.currentPeriodStart ?? undefined;
          trialEndsAt = subscription.currentPeriodEnd ?? undefined;
        }

        await startOrganizationPremiumTrial({
          database,
          organizationId,
          trialStartedAt,
          trialEndsAt,
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          billingInterval,
        });
        const nextBillingSnapshot = await readOrganizationBillingObservationSnapshot({
          database,
          env,
          organizationId,
        });
        await appendOrganizationBillingAuditEvent({
          database,
          organizationId,
          sourceKind: 'trial_start',
          previousSnapshot: previousBillingSnapshot,
          nextSnapshot: nextBillingSnapshot,
          sourceContext: 'owner_started_premium_trial',
        });
        await markBillingOperationAttemptSucceeded({
          database,
          attemptId: operation.attempt.id,
          stripeCustomerId,
          stripeSubscriptionId,
        });

        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'succeeded',
            message: `Started a ${ORGANIZATION_PREMIUM_TRIAL_DURATION_DAYS}-day premium trial.`,
          }),
          200,
        );
      } catch (error) {
        const message = toBillingOperationFailureMessage(error, 'Premium trial start failed.');
        await markBillingOperationAttemptFailed({
          database,
          attemptId: operation.attempt.id,
          failureReason: message,
        });
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'failed',
            message,
          }),
          500,
        );
      }
    })();
  });

  authRoutes.openapi(createOrganizationBillingPaymentMethodRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organizationId = resolveOrganizationId(
        body.organizationId,
        identity.activeOrganizationId,
      );
      if (!organizationId) {
        return c.json({ message: 'organizationId is required.' }, 422);
      }

      const role = await readOrganizationMembershipRole({
        organizationId,
        userId: identity.userId,
      });
      if (role !== 'owner') {
        return c.json({ message: 'Forbidden' }, 403);
      }

      if (!env.STRIPE_SECRET_KEY?.trim()) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'failed',
            message: 'Stripe billing is not configured.',
          }),
          422,
        );
      }

      const billing = await selectOrganizationBillingSummary(database, organizationId);
      if (billing?.planCode !== 'premium' || billing.subscriptionStatus !== 'trialing') {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'conflict',
            message: 'Organization does not have an active premium trial.',
          }),
          409,
        );
      }

      const now = new Date();
      const operation = await createBillingOperationAttempt({
        database,
        organizationId,
        purpose: 'payment_method_setup',
        createdByUserId: identity.userId,
        now,
      });
      if (operation.reused && operation.attempt.handoffUrl) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: operation.attempt.state === 'succeeded' ? 'succeeded' : 'processing',
            message: 'Reusing the active payment method setup handoff.',
            handoffAttempt: operation.attempt,
            handoffPurpose: 'payment_method_setup',
            handoffReused: true,
          }),
          200,
        );
      }
      if (operation.reused) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'conflict',
            message: 'Billing operation is already processing. Please retry shortly.',
          }),
          409,
        );
      }

      try {
        const provider = createStripeBillingProvider({ env });
        let customerId = billing.stripeCustomerId;
        if (!customerId) {
          const previousBillingSnapshot = await readOrganizationBillingObservationSnapshot({
            database,
            env,
            organizationId,
          });
          const customer = await provider.createCustomer({
            idempotencyKey: `${operation.attempt.idempotencyKey}:customer`,
            metadata: {
              billingPurpose: 'organization_payment_method',
              organizationId,
              billingOperationAttemptId: operation.attempt.id,
            },
          });
          customerId = customer.id;
          await updateOrganizationBillingStripeCustomerId({
            database,
            organizationId,
            stripeCustomerId: customerId,
          });
          const nextBillingSnapshot = await readOrganizationBillingObservationSnapshot({
            database,
            env,
            organizationId,
          });
          await appendOrganizationBillingAuditEvent({
            database,
            organizationId,
            sourceKind: 'payment_method_customer_linked',
            previousSnapshot: previousBillingSnapshot,
            nextSnapshot: nextBillingSnapshot,
            sourceContext: 'stripe_customer_created_for_payment_method_registration',
          });
        }

        const webBaseUrl = (env.WEB_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
        const contractsUrl = `${webBaseUrl}/admin/contracts`;
        const session = await provider.createSetupCheckoutSession({
          customerId,
          successUrl: `${contractsUrl}?paymentMethod=success`,
          cancelUrl: `${contractsUrl}?paymentMethod=cancel`,
          idempotencyKey: operation.attempt.idempotencyKey,
          metadata: {
            billingPurpose: 'organization_payment_method',
            organizationId,
            billingOperationAttemptId: operation.attempt.id,
          },
        });
        const succeededAttempt = await markBillingOperationAttemptSucceeded({
          database,
          attemptId: operation.attempt.id,
          handoffUrl: session.url,
          handoffExpiresAt: new Date(now.getTime() + BILLING_HANDOFF_REUSE_WINDOW_MS),
          stripeCustomerId: customerId,
          stripeSubscriptionId: billing.stripeSubscriptionId ?? null,
          stripeCheckoutSessionId: session.id,
        });

        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'processing',
            message: 'Payment method setup handoff is ready.',
            handoffAttempt: succeededAttempt,
            handoffPurpose: 'payment_method_setup',
            handoffReused: false,
          }),
          200,
        );
      } catch (error) {
        const message = toBillingOperationFailureMessage(
          error,
          'Payment method setup handoff failed.',
        );
        await markBillingOperationAttemptFailed({
          database,
          attemptId: operation.attempt.id,
          failureReason: message,
        });
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'failed',
            message,
          }),
          500,
        );
      }
    })();
  });

  authRoutes.openapi(createOrganizationBillingTrialCompletionRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organizationId = resolveOrganizationId(
        body.organizationId,
        identity.activeOrganizationId,
      );
      if (!organizationId) {
        return c.json({ message: 'organizationId is required.' }, 422);
      }

      const role = await readOrganizationMembershipRole({
        organizationId,
        userId: identity.userId,
      });
      if (role !== 'owner') {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const previousBillingSnapshot = await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId,
      });
      const completion = await applyOrganizationPremiumTrialCompletion({
        database,
        env,
        organizationId,
      });
      if (!completion.ok) {
        const currentBillingSnapshot = await readOrganizationBillingObservationSnapshot({
          database,
          env,
          organizationId,
        });
        await appendOrganizationBillingSignal({
          database,
          organizationId,
          signalKind: 'reconciliation',
          signalStatus: completion.status === 503 ? 'pending' : 'unavailable',
          sourceKind: 'trial_completion',
          reason:
            completion.status === 503
              ? 'trial_completion_pending'
              : 'trial_completion_not_ready_or_unavailable',
          appSnapshot: currentBillingSnapshot,
        });
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: completion.status === 409 ? 'conflict' : 'failed',
            message: completion.message,
          }),
          completion.status,
        );
      }

      const nextBillingSnapshot = await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId,
      });
      await appendOrganizationBillingAuditEvent({
        database,
        organizationId,
        sourceKind: 'trial_completion',
        previousSnapshot: previousBillingSnapshot,
        nextSnapshot: nextBillingSnapshot,
        sourceContext: completion.message,
      });
      await appendResolvedBillingSignalIfNeeded({
        database,
        organizationId,
        signalKind: 'reconciliation',
        sourceKind: 'trial_completion',
        reason: 'trial_completion_applied',
        appSnapshot: nextBillingSnapshot,
      });

      return c.json(
        await buildBillingActionEnvelope({
          organizationId,
          role,
          status: 'succeeded',
          message: completion.message,
        }),
        200,
      );
    })();
  });

  authRoutes.openapi(createOrganizationBillingPortalRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organizationId = resolveOrganizationId(
        body.organizationId,
        identity.activeOrganizationId,
      );
      if (!organizationId) {
        return c.json({ message: 'organizationId is required.' }, 422);
      }

      const role = await readOrganizationMembershipRole({
        organizationId,
        userId: identity.userId,
      });
      if (role !== 'owner') {
        return c.json({ message: 'Forbidden' }, 403);
      }

      if (!env.STRIPE_SECRET_KEY?.trim()) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'failed',
            message: 'Stripe billing is not configured.',
          }),
          422,
        );
      }

      const billing = await selectOrganizationBillingSummary(database, organizationId);
      const portalSubscriptionStatus = isBillingSubscriptionStatus(
        billing?.subscriptionStatus ?? null,
      );
      if (
        !billing?.stripeCustomerId ||
        !billing.stripeSubscriptionId ||
        billing.planCode !== 'premium' ||
        !(
          portalSubscriptionStatus === 'active' ||
          portalSubscriptionStatus === 'trialing' ||
          portalSubscriptionStatus === 'past_due' ||
          portalSubscriptionStatus === 'unpaid' ||
          portalSubscriptionStatus === 'incomplete'
        )
      ) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'conflict',
            message:
              'Billing portal is unavailable for free, canceled, or no-provider-subscription state.',
          }),
          409,
        );
      }

      const now = new Date();
      const operation = await createBillingOperationAttempt({
        database,
        organizationId,
        purpose: 'billing_portal',
        stripeSubscriptionId: billing.stripeSubscriptionId,
        createdByUserId: identity.userId,
        now,
      });
      if (operation.reused && operation.attempt.handoffUrl) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: operation.attempt.state === 'succeeded' ? 'succeeded' : 'processing',
            message: 'Reusing the active billing portal handoff.',
            handoffAttempt: operation.attempt,
            handoffPurpose: 'billing_portal',
            handoffReused: true,
          }),
          200,
        );
      }
      if (operation.reused) {
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'conflict',
            message: 'Billing operation is already processing. Please retry shortly.',
          }),
          409,
        );
      }

      try {
        const webBaseUrl = (env.WEB_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
        const contractsUrl = `${webBaseUrl}/admin/contracts`;
        const provider = createStripeBillingProvider({ env });
        const portalSession = await provider.createBillingPortalSession({
          customerId: billing.stripeCustomerId,
          returnUrl: contractsUrl,
          idempotencyKey: operation.attempt.idempotencyKey,
          flow: {
            type: 'subscription_update',
            subscriptionId: billing.stripeSubscriptionId,
          },
        });
        const succeededAttempt = await markBillingOperationAttemptSucceeded({
          database,
          attemptId: operation.attempt.id,
          handoffUrl: portalSession.url,
          handoffExpiresAt: new Date(now.getTime() + BILLING_HANDOFF_REUSE_WINDOW_MS),
          stripeCustomerId: billing.stripeCustomerId,
          stripeSubscriptionId: billing.stripeSubscriptionId,
          stripePortalSessionId: portalSession.id,
        });

        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'processing',
            message: 'Billing portal handoff is ready.',
            handoffAttempt: succeededAttempt,
            handoffPurpose: 'billing_portal',
            handoffReused: false,
          }),
          200,
        );
      } catch (error) {
        const message = toBillingOperationFailureMessage(error, 'Billing portal handoff failed.');
        await markBillingOperationAttemptFailed({
          database,
          attemptId: operation.attempt.id,
          failureReason: message,
        });
        return c.json(
          await buildBillingActionEnvelope({
            organizationId,
            role,
            status: 'failed',
            message,
          }),
          500,
        );
      }
    })();
  });

  authRoutes.openapi(getInternalBillingInspectionRoute, (c) => {
    return (async () => {
      const { organizationId } = c.req.valid('param');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      if (
        !canAccessInternalBillingInspection({
          env,
          email: identity.email,
          emailVerified: identity.emailVerified,
        })
      ) {
        return c.json({ message: INTERNAL_BILLING_INSPECTION_DENIED_MESSAGE }, 403);
      }

      const inspection = await readInternalBillingInspection({
        database,
        env,
        organizationId,
      });
      if (!inspection) {
        return c.json({ message: 'Organization not found.' }, 404);
      }

      return c.json(inspection, 200);
    })();
  });
};
