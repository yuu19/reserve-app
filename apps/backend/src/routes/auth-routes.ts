import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import {
  canViewOrganizationBillingByRole,
  canManageParticipantsByRole,
  listOrganizationClassroomContexts,
  readOrganizationPremiumFeatureGate,
  resolveOrganizationClassroomAccess,
  resolveOrganizationClassroomContext,
} from '../booking/authorization.js';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import {
  applyOrganizationPremiumTrialCompletion,
  ensureOrganizationBillingRow,
  hasActivePremiumSubscription,
  hasOrganizationStartedPremiumTrial,
  isBillingInterval,
  isBillingSubscriptionStatus,
  ORGANIZATION_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE,
  ORGANIZATION_PREMIUM_TRIAL_DURATION_DAYS,
  resolveOrganizationBillingActionAvailability,
  resolveOrganizationBillingPaymentMethodStatus,
  resolveOrganizationBillingProfileReadiness,
  selectOrganizationBillingSummary,
  startOrganizationPremiumTrial,
  updateOrganizationBillingStripeCustomerId,
} from '../billing/organization-billing.js';
import { buildBillingDocumentReadiness } from '../billing/organization-billing-documents.js';
import {
  readOrganizationBillingDocumentReferences,
  readOrganizationBillingInvoicePaymentEvents,
} from '../billing/organization-billing-invoice-events.js';
import { readOrganizationOwnerBillingHistory } from '../billing/organization-billing-history.js';
import { readInternalBillingInspection } from '../billing/internal-billing-inspection.js';
import {
  canAccessInternalBillingInspection,
  INTERNAL_BILLING_INSPECTION_DENIED_MESSAGE,
} from '../billing/internal-operator-access.js';
import { resolveOrganizationPremiumEntitlementPolicy } from '../billing/organization-billing-policy.js';
import {
  appendOrganizationBillingAuditEvent,
  appendOrganizationBillingSignal,
  appendResolvedBillingSignalIfNeeded,
  readOrganizationBillingObservationSnapshot,
} from '../billing/organization-billing-observability.js';
import {
  BILLING_HANDOFF_REUSE_WINDOW_MS,
  createBillingOperationAttempt,
  markBillingOperationAttemptFailed,
  markBillingOperationAttemptSucceeded,
  type OrganizationBillingOperationAttempt,
  type OrganizationBillingOperationPurpose,
} from '../billing/organization-billing-operations.js';
import * as dbSchema from '../db/schema.js';
import {
  sendOrganizationInvitationEmail,
  sendParticipantInvitationEmail,
} from '../email/resend.js';
import type { OrganizationLogoService } from '../organization-logo-service.js';
import {
  createBillingPortalSession,
  createCustomer,
  createSetupCheckoutSession,
  createSubscriptionCheckoutSession,
  createTrialSubscription,
} from '../payment/stripe.js';
import type { ServiceImageUploadService } from '../service-image-upload-service.js';
import { registerBookingRoutes } from './booking-routes.js';

type AuthRouteBindings = {
  Variables: {
    user: Record<string, unknown> | null;
    session: Record<string, unknown> | null;
  };
};

type CreateAuthRoutesOptions = {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationLogoService?: OrganizationLogoService | null;
  serviceImageUploadService?: ServiceImageUploadService | null;
};

const LOGO_KEY_PATTERN = /^[a-zA-Z0-9._-]+$/;

const isFileEntry = (value: FormDataEntryValue | null): value is File => {
  return typeof File !== 'undefined' && value instanceof File;
};

const getIpAddress = (headers: Headers): string | null => {
  const cfConnectingIp = headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const forwarded = headers.get('x-forwarded-for');
  if (!forwarded) {
    return null;
  }

  const [first] = forwarded.split(',');
  return first?.trim() ?? null;
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

const authSessionSchema = z.union([
  z.null(),
  z.object({
    user: z.record(z.string(), z.unknown()),
    session: z.record(z.string(), z.unknown()),
  }),
]);

const signUpBodySchema = z.object({
  name: z.string().min(1).max(120),
  email: z.email(),
  password: z.string().min(8).max(128),
});

const signInBodySchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

const googleOidcQuerySchema = z.object({
  callbackURL: z.string().optional(),
  errorCallbackURL: z.string().optional(),
  newUserCallbackURL: z.string().optional(),
  disableRedirect: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

const createOrganizationBodySchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(120),
  logo: z.string().max(2048).optional(),
  keepCurrentActiveOrganization: z.boolean().optional(),
});

const setActiveOrganizationBodySchema = z.object({
  organizationId: z.string().min(1).nullable().optional(),
  organizationSlug: z.string().min(1).optional(),
});

const getFullOrganizationQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

const listParticipantsQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
});

const selfEnrollParticipantBodySchema = z.object({
  organizationId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
});

const signUpRoute = createRoute({
  method: 'post',
  path: '/sign-up',
  tags: ['Auth'],
  summary: 'Sign up with email and password',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: signUpBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Signed up',
    },
    400: {
      description: 'Auth error',
    },
  },
});

const signInRoute = createRoute({
  method: 'post',
  path: '/sign-in',
  tags: ['Auth'],
  summary: 'Sign in with email and password',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: signInBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Signed in',
    },
    400: {
      description: 'Auth error',
    },
  },
});

const signOutRoute = createRoute({
  method: 'post',
  path: '/sign-out',
  tags: ['Auth'],
  summary: 'Sign out current session',
  responses: {
    200: {
      description: 'Signed out',
    },
    401: {
      description: 'Not signed in',
    },
  },
});

const googleOidcRoute = createRoute({
  method: 'get',
  path: '/oidc/google',
  tags: ['Auth'],
  summary: 'Start Google OIDC login flow',
  request: {
    query: googleOidcQuerySchema,
  },
  responses: {
    200: {
      description: 'OIDC login initiated',
    },
    302: {
      description: 'Redirect to Google OIDC consent page',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const sessionRoute = createRoute({
  method: 'get',
  path: '/session',
  tags: ['Auth'],
  summary: 'Get current session',
  responses: {
    200: {
      description: 'Session payload',
      content: {
        'application/json': {
          schema: authSessionSchema,
        },
      },
    },
  },
});

const createOrganizationRoute = createRoute({
  method: 'post',
  path: '/organizations',
  tags: ['Organization'],
  summary: 'Create an organization',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createOrganizationBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Organization created',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const listOrganizationsRoute = createRoute({
  method: 'get',
  path: '/organizations',
  tags: ['Organization'],
  summary: 'List organizations for current user',
  responses: {
    200: {
      description: 'Organization list',
    },
    401: {
      description: 'Unauthorized',
    },
  },
});

const setActiveOrganizationRoute = createRoute({
  method: 'post',
  path: '/organizations/set-active',
  tags: ['Organization'],
  summary: 'Set active organization for current session',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: setActiveOrganizationBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Active organization updated',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const getFullOrganizationRoute = createRoute({
  method: 'get',
  path: '/organizations/full',
  tags: ['Organization'],
  summary: 'Get active organization details',
  request: {
    query: getFullOrganizationQuerySchema,
  },
  responses: {
    200: {
      description: 'Organization details',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

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
  notificationKind: z.enum(['trial_will_end_email', 'trial_will_end', 'unknown']),
  communicationType: z.enum(['trial_will_end', 'payment_issue', 'unknown']),
  channel: z.enum(['email', 'in_app', 'web_push', 'unknown']),
  channelLabel: z.string().min(1),
  deliveryState: z.enum(['requested', 'retried', 'sent', 'failed', 'unknown']),
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
  deliveryState: z.enum(['requested', 'retried', 'sent', 'failed', 'unknown']).nullable(),
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
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
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
      content: { 'application/json': { schema: z.object({ message: z.string().min(1) }) } },
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

const organizationMembershipRoleSchema = z.enum(['owner', 'admin', 'member']);
const classroomStaffRoleSchema = z.enum(['manager', 'staff']);
const accessDisplayRoleSchema = z.enum(['owner', 'admin', 'manager', 'staff', 'participant']);
const accessSourceSchema = z.enum(['org_role', 'classroom_member', 'participant_record']);
const messageResponseSchema = z.object({
  message: z.string().min(1),
});
const invitationStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'cancelled', 'expired']);

const messageResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: messageResponseSchema,
    },
  },
});

const accessFactsSchema = z.object({
  orgRole: organizationMembershipRoleSchema.nullable(),
  classroomStaffRole: classroomStaffRoleSchema.nullable(),
  hasParticipantRecord: z.boolean(),
});

const accessEffectiveSchema = z.object({
  canManageOrganization: z.boolean(),
  canManageClassroom: z.boolean(),
  canManageBookings: z.boolean(),
  canManageParticipants: z.boolean(),
  canUseParticipantBooking: z.boolean(),
});

const accessSourcesSchema = z.object({
  canManageOrganization: accessSourceSchema.extract(['org_role']).nullable(),
  canManageClassroom: accessSourceSchema.extract(['org_role', 'classroom_member']).nullable(),
  canManageBookings: accessSourceSchema.extract(['org_role', 'classroom_member']).nullable(),
  canManageParticipants: accessSourceSchema.extract(['org_role', 'classroom_member']).nullable(),
  canUseParticipantBooking: accessSourceSchema.extract(['participant_record']).nullable(),
});

const accessDisplaySchema = z.object({
  primaryRole: accessDisplayRoleSchema.nullable(),
  badges: z.array(accessDisplayRoleSchema),
});

const classroomAccessSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  logo: z.string().min(1).nullable().optional(),
  facts: accessFactsSchema,
  effective: accessEffectiveSchema,
  sources: accessSourcesSchema,
  display: accessDisplaySchema,
});

const accessTreeOrganizationSchema = z.object({
  org: z.object({
    id: z.string().min(1),
    slug: z.string().min(1),
    name: z.string().min(1),
    logo: z.string().min(1).nullable().optional(),
  }),
  facts: z.object({
    orgRole: organizationMembershipRoleSchema.nullable(),
  }),
  classrooms: z.array(classroomAccessSchema),
});

const accessTreeResponseSchema = z.object({
  orgs: z.array(accessTreeOrganizationSchema),
});

const organizationClassroomsRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
});

const organizationClassroomRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
  classroomSlug: z.string().min(1),
});

const classroomManagementSchema = classroomAccessSchema;

const createClassroomBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120),
});

const updateClassroomBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120),
});

const listOrganizationAccessTreeRoute = createRoute({
  method: 'get',
  path: '/orgs/access-tree',
  tags: ['Organization'],
  summary: 'List organization and classroom access tree for current user',
  responses: {
    200: {
      description: 'Organization access tree',
      content: {
        'application/json': {
          schema: accessTreeResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
  },
});

const listOrganizationClassroomsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/classrooms',
  tags: ['Classroom'],
  summary: 'List accessible classrooms in an organization',
  request: {
    params: organizationClassroomsRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Accessible classroom list',
      content: {
        'application/json': {
          schema: z.array(classroomManagementSchema),
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Organization not found',
    },
  },
});

const createClassroomRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/classrooms',
  tags: ['Classroom'],
  summary: 'Create a classroom in an organization',
  request: {
    params: organizationClassroomsRouteParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createClassroomBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Created classroom',
      content: {
        'application/json': {
          schema: classroomManagementSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Organization not found',
    },
    409: {
      description: 'Classroom slug already exists',
    },
  },
});

const updateClassroomRoute = createRoute({
  method: 'patch',
  path: '/orgs/{orgSlug}/classrooms/{classroomSlug}',
  tags: ['Classroom'],
  summary: 'Update a classroom in an organization',
  request: {
    params: organizationClassroomRouteParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: updateClassroomBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated classroom',
      content: {
        'application/json': {
          schema: classroomManagementSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Organization or classroom not found',
    },
    409: {
      description: 'Classroom slug already exists',
    },
  },
});

const orgInvitationRoleSchema = z.enum(['admin', 'member']);
const classroomInvitationRoleSchema = z.enum(['manager', 'staff', 'participant']);
const unifiedInvitationRoleSchema = z.enum(['admin', 'member', 'manager', 'staff', 'participant']);
const invitationSubjectKindSchema = z.enum(['org_operator', 'classroom_operator', 'participant']);

const organizationInvitationRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
});

const classroomInvitationRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
  classroomSlug: z.string().min(1),
});

const invitationIdRouteParamsSchema = z.object({
  invitationId: z.string().min(1),
});

const createOrganizationInvitationBodySchema = z.object({
  email: z.email(),
  role: orgInvitationRoleSchema,
  resend: z.boolean().optional(),
});

const createClassroomInvitationBodySchema = z.object({
  email: z.email(),
  role: classroomInvitationRoleSchema,
  participantName: z.string().trim().min(1).max(120).optional(),
  resend: z.boolean().optional(),
});

const invitationSchema = z.object({
  id: z.string().min(1),
  subjectKind: invitationSubjectKindSchema,
  role: unifiedInvitationRoleSchema,
  organizationId: z.string().min(1),
  organizationSlug: z.string().min(1),
  organizationName: z.string().min(1),
  classroomId: z.string().min(1).nullable(),
  classroomSlug: z.string().min(1).nullable(),
  classroomName: z.string().min(1).nullable(),
  email: z.string().email(),
  participantName: z.string().nullable(),
  status: invitationStatusSchema,
  expiresAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  invitedByUserId: z.string().nullable(),
  respondedByUserId: z.string().nullable(),
  respondedAt: z.string().nullable(),
});

const invitationAcceptResponseSchema = z.object({
  invitation: invitationSchema,
  accepted: z.object({
    memberId: z.string().nullable(),
    classroomMemberId: z.string().nullable(),
    participantId: z.string().nullable(),
  }),
});

const createOrganizationInvitationRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/invitations',
  tags: ['Invitations'],
  summary: 'Create or resend organization operator invitation',
  request: {
    params: organizationInvitationRouteParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createOrganizationInvitationBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation created or resent',
      content: {
        'application/json': {
          schema: invitationSchema,
        },
      },
    },
    400: messageResponse('Validation error'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Organization not found'),
    409: messageResponse('Invitation already exists'),
    429: messageResponse('Invitation resend limit reached'),
    500: messageResponse('Unexpected error'),
  },
});

const listOrganizationInvitationsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/invitations',
  tags: ['Invitations'],
  summary: 'List organization operator invitations',
  request: {
    params: organizationInvitationRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation list',
      content: {
        'application/json': {
          schema: z.array(invitationSchema),
        },
      },
    },
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Organization not found'),
  },
});

const createClassroomInvitationRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/classrooms/{classroomSlug}/invitations',
  tags: ['Invitations'],
  summary: 'Create or resend classroom invitation',
  request: {
    params: classroomInvitationRouteParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createClassroomInvitationBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation created or resent',
      content: {
        'application/json': {
          schema: invitationSchema,
        },
      },
    },
    400: messageResponse('Validation error'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Organization or classroom not found'),
    409: messageResponse('Invitation already exists'),
    429: messageResponse('Invitation resend limit reached'),
    500: messageResponse('Unexpected error'),
  },
});

const listClassroomInvitationsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/classrooms/{classroomSlug}/invitations',
  tags: ['Invitations'],
  summary: 'List classroom invitations',
  request: {
    params: classroomInvitationRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation list',
      content: {
        'application/json': {
          schema: z.array(invitationSchema),
        },
      },
    },
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Organization or classroom not found'),
  },
});

const listUserInvitationsRoute = createRoute({
  method: 'get',
  path: '/invitations/user',
  tags: ['Invitations'],
  summary: 'List invitations for current user email',
  responses: {
    200: {
      description: 'Invitation list',
      content: {
        'application/json': {
          schema: z.array(invitationSchema),
        },
      },
    },
    401: messageResponse('Unauthorized'),
    400: messageResponse('Current user email is unavailable'),
  },
});

const invitationDetailRoute = createRoute({
  method: 'get',
  path: '/invitations/{invitationId}',
  tags: ['Invitations'],
  summary: 'Get invitation detail',
  request: {
    params: invitationIdRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation detail',
      content: {
        'application/json': {
          schema: invitationSchema,
        },
      },
    },
    400: messageResponse('Current user email is unavailable'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Invitation not found'),
  },
});

const acceptInvitationRoute = createRoute({
  method: 'post',
  path: '/invitations/{invitationId}/accept',
  tags: ['Invitations'],
  summary: 'Accept invitation',
  request: {
    params: invitationIdRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation accepted',
      content: {
        'application/json': {
          schema: invitationAcceptResponseSchema,
        },
      },
    },
    400: messageResponse('Invitation cannot be accepted'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Invitation not found'),
    409: messageResponse('Invitation already fulfilled'),
  },
});

const rejectInvitationRoute = createRoute({
  method: 'post',
  path: '/invitations/{invitationId}/reject',
  tags: ['Invitations'],
  summary: 'Reject invitation',
  request: {
    params: invitationIdRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation rejected',
      content: {
        'application/json': {
          schema: invitationSchema,
        },
      },
    },
    400: messageResponse('Invitation cannot be rejected'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Invitation not found'),
  },
});

const cancelInvitationRoute = createRoute({
  method: 'post',
  path: '/invitations/{invitationId}/cancel',
  tags: ['Invitations'],
  summary: 'Cancel invitation',
  request: {
    params: invitationIdRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation canceled',
      content: {
        'application/json': {
          schema: invitationSchema,
        },
      },
    },
    400: messageResponse('Invitation cannot be cancelled'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Invitation not found'),
  },
});

const listParticipantsRoute = createRoute({
  method: 'get',
  path: '/organizations/participants',
  tags: ['Participants'],
  summary: 'List participants in an organization',
  request: {
    query: listParticipantsQuerySchema,
  },
  responses: {
    200: {
      description: 'Participant list',
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    400: {
      description: 'Validation error',
    },
  },
});

const selfEnrollParticipantRoute = createRoute({
  method: 'post',
  path: '/organizations/participants/self-enroll',
  tags: ['Participants'],
  summary: 'Create participant membership for current user in public organization',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: selfEnrollParticipantBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Participant membership ensured',
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    400: {
      description: 'Validation error',
    },
    503: {
      description: 'Public organization is not configured',
    },
  },
});

export const createAuthRoutes = (auth: AuthInstance, options: CreateAuthRoutesOptions) => {
  const database = options.database;
  const env = options.env;
  const organizationLogoService = options.organizationLogoService ?? null;
  const serviceImageUploadService = options.serviceImageUploadService ?? null;
  const authRoutes = new OpenAPIHono<AuthRouteBindings>();
  const hasCookieDomain = Boolean(env.BETTER_AUTH_COOKIE_DOMAIN?.trim());
  const appendLegacyOAuthStateCleanupCookie = (headers: Headers) => {
    if (!hasCookieDomain) {
      return;
    }

    // Clear legacy host-only auth cookies to avoid mismatched state/session after
    // migrating to Domain=.wakureserve.com cookies.
    const legacyCookieNames = [
      '__Secure-better-auth.oauth_state',
      '__Secure-better-auth.session_token',
      '__Secure-better-auth.session_data',
      '__Secure-better-auth.pkce_code_verifier',
      'better-auth.session_token',
      'better-auth.session_data',
      'better-auth.pkce_code_verifier',
    ];

    for (const cookieName of legacyCookieNames) {
      headers.append(
        'set-cookie',
        `${cookieName}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
      );
    }
  };

  type InvitationSubjectKind = z.infer<typeof invitationSubjectKindSchema>;
  type UnifiedInvitationRole = z.infer<typeof unifiedInvitationRoleSchema>;
  type InvitationStatus = z.infer<typeof invitationStatusSchema>;
  type InvitationEventType =
    | 'created'
    | 'resent'
    | 'accepted'
    | 'rejected'
    | 'cancelled'
    | 'expired';
  type InvitationRecord = {
    id: string;
    subjectKind: string;
    organizationId: string;
    organizationSlug: string;
    organizationName: string;
    classroomId: string | null;
    classroomSlug: string | null;
    classroomName: string | null;
    email: string;
    role: string;
    principalKind: string;
    participantName: string | null;
    status: string;
    expiresAt: unknown;
    createdAt: unknown;
    invitedByUserId: string;
    respondedByUserId: string | null;
    respondedAt: unknown;
    acceptedMemberId: string | null;
    acceptedClassroomMemberId: string | null;
    acceptedParticipantId: string | null;
  };

  const normalizeEmail = (value: string): string => value.trim().toLowerCase();

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

  const resolveOrganizationId = (
    requestedOrganizationId: string | undefined,
    activeOrganizationId: string | null,
  ) => {
    return requestedOrganizationId ?? activeOrganizationId;
  };

  const hasOrganizationAdminAccess = async ({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<boolean> => {
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
    return canManageParticipantsByRole(
      role === 'owner' || role === 'admin' || role === 'member' ? role : null,
    );
  };

  const isOrganizationMembershipRole = (
    value: string | null,
  ): 'owner' | 'admin' | 'member' | null => {
    if (value === 'owner' || value === 'admin' || value === 'member') {
      return value;
    }
    return null;
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

    return isOrganizationMembershipRole(rows[0]?.role ?? null);
  };

  const canCreateOrganizationForIdentity = async ({
    userId,
    email,
  }: {
    userId: string;
    email: string | null;
  }): Promise<boolean> => {
    const ownerMembership = await database
      .select({ id: dbSchema.member.id })
      .from(dbSchema.member)
      .where(and(eq(dbSchema.member.userId, userId), eq(dbSchema.member.role, 'owner')))
      .limit(1);
    if (ownerMembership[0]) {
      return true;
    }

    const [memberRows, classroomMemberRows, participantRows, pendingInvitationRows] =
      await Promise.all([
        database
          .select({ id: dbSchema.member.id })
          .from(dbSchema.member)
          .where(eq(dbSchema.member.userId, userId))
          .limit(1),
        database
          .select({ id: dbSchema.classroomMember.id })
          .from(dbSchema.classroomMember)
          .where(eq(dbSchema.classroomMember.userId, userId))
          .limit(1),
        database
          .select({ id: dbSchema.participant.id })
          .from(dbSchema.participant)
          .where(eq(dbSchema.participant.userId, userId))
          .limit(1),
        email
          ? database
              .select({ id: dbSchema.invitation.id })
              .from(dbSchema.invitation)
              .where(
                and(
                  eq(dbSchema.invitation.status, 'pending'),
                  sql`lower(${dbSchema.invitation.email}) = ${email}`,
                  sql`${dbSchema.invitation.expiresAt} > ${Date.now()}`,
                ),
              )
              .limit(1)
          : Promise.resolve([] as { id: string }[]),
      ]);

    return (
      !memberRows[0] && !classroomMemberRows[0] && !participantRows[0] && !pendingInvitationRows[0]
    );
  };

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

  const resolveDefaultPremiumTrialPriceConfig = (): {
    priceId: string;
    billingInterval: 'month' | 'year';
  } | null => {
    if (env.STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED !== 'true') {
      return null;
    }

    const monthlyPriceId = env.STRIPE_PREMIUM_MONTHLY_PRICE_ID?.trim();
    if (monthlyPriceId) {
      return {
        priceId: monthlyPriceId,
        billingInterval: 'month',
      };
    }

    const yearlyPriceId = env.STRIPE_PREMIUM_YEARLY_PRICE_ID?.trim();
    if (yearlyPriceId) {
      return {
        priceId: yearlyPriceId,
        billingInterval: 'year',
      };
    }

    return null;
  };

  const resolveBillingAvailableIntervals = (): Array<'month' | 'year'> => {
    const intervals: Array<'month' | 'year'> = [];
    if (env.STRIPE_PREMIUM_MONTHLY_PRICE_ID?.trim()) {
      intervals.push('month');
    }
    if (env.STRIPE_PREMIUM_YEARLY_PRICE_ID?.trim()) {
      intervals.push('year');
    }
    return intervals;
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
    const [history, documentReferences, invoicePaymentEvents] =
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
            readOrganizationBillingInvoicePaymentEvents({
              database,
              organizationId,
            }),
          ])
        : [null, [], []];
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

  const serializeParticipant = (
    participant: {
      id: string;
      organizationId: string;
      classroomId?: string;
      classroomSlug?: string | null;
      classroomName?: string | null;
      userId: string;
      email: string;
      name: string;
      createdAt: unknown;
      updatedAt: unknown;
    } | null,
  ) => {
    if (!participant) {
      return null;
    }

    return {
      id: participant.id,
      organizationId: participant.organizationId,
      classroomId: participant.classroomId ?? null,
      classroomSlug: participant.classroomSlug ?? null,
      classroomName: participant.classroomName ?? null,
      userId: participant.userId,
      email: participant.email,
      name: participant.name,
      createdAt: toIsoDateString(participant.createdAt),
      updatedAt: toIsoDateString(participant.updatedAt),
    };
  };

  const normalizeInvitationSubjectKind = (value: string | null): InvitationSubjectKind | null => {
    if (value === 'org_operator' || value === 'classroom_operator' || value === 'participant') {
      return value;
    }

    return null;
  };

  const normalizeUnifiedInvitationRole = (value: string | null): UnifiedInvitationRole | null => {
    if (
      value === 'admin' ||
      value === 'member' ||
      value === 'manager' ||
      value === 'staff' ||
      value === 'participant'
    ) {
      return value;
    }

    return null;
  };

  const normalizeInvitationStatus = (
    value: string | null,
    expiresAt: unknown,
  ): InvitationStatus | null => {
    const normalized = value === 'canceled' ? 'cancelled' : value;
    if (
      normalized !== 'pending' &&
      normalized !== 'accepted' &&
      normalized !== 'rejected' &&
      normalized !== 'cancelled' &&
      normalized !== 'expired'
    ) {
      return null;
    }

    if (normalized === 'pending') {
      const expiresAtTimestamp = toTimestamp(expiresAt);
      if (expiresAtTimestamp !== null && expiresAtTimestamp <= Date.now()) {
        return 'expired';
      }
    }

    return normalized;
  };

  const invitationRecordSelection = {
    id: dbSchema.invitation.id,
    subjectKind: dbSchema.invitation.subjectKind,
    organizationId: dbSchema.invitation.organizationId,
    organizationSlug: dbSchema.organization.slug,
    organizationName: dbSchema.organization.name,
    classroomId: dbSchema.invitation.classroomId,
    classroomSlug: dbSchema.classroom.slug,
    classroomName: dbSchema.classroom.name,
    email: dbSchema.invitation.email,
    role: dbSchema.invitation.role,
    principalKind: dbSchema.invitation.principalKind,
    participantName: dbSchema.invitation.participantName,
    status: dbSchema.invitation.status,
    expiresAt: dbSchema.invitation.expiresAt,
    createdAt: dbSchema.invitation.createdAt,
    invitedByUserId: dbSchema.invitation.invitedByUserId,
    respondedByUserId: dbSchema.invitation.respondedByUserId,
    respondedAt: dbSchema.invitation.respondedAt,
    acceptedMemberId: dbSchema.invitation.acceptedMemberId,
    acceptedClassroomMemberId: dbSchema.invitation.acceptedClassroomMemberId,
    acceptedParticipantId: dbSchema.invitation.acceptedParticipantId,
  };

  const selectInvitationRecords = async (whereClause: SQL<unknown> | undefined) => {
    const query = database
      .select(invitationRecordSelection)
      .from(dbSchema.invitation)
      .innerJoin(
        dbSchema.organization,
        eq(dbSchema.organization.id, dbSchema.invitation.organizationId),
      )
      .leftJoin(dbSchema.classroom, eq(dbSchema.classroom.id, dbSchema.invitation.classroomId));

    return (whereClause ? query.where(whereClause) : query).orderBy(
      desc(dbSchema.invitation.createdAt),
    );
  };

  const serializeInvitation = (invitation: InvitationRecord | null) => {
    if (!invitation) {
      return null;
    }

    const subjectKind = normalizeInvitationSubjectKind(invitation.subjectKind);
    const role = normalizeUnifiedInvitationRole(invitation.role);
    const status = normalizeInvitationStatus(invitation.status, invitation.expiresAt);
    if (!subjectKind || !role || !status) {
      return null;
    }

    return {
      id: invitation.id,
      subjectKind,
      role,
      organizationId: invitation.organizationId,
      organizationSlug: invitation.organizationSlug,
      organizationName: invitation.organizationName,
      classroomId: invitation.classroomId,
      classroomSlug: invitation.classroomSlug,
      classroomName: invitation.classroomName,
      email: invitation.email,
      participantName: invitation.participantName ?? null,
      status,
      expiresAt: toIsoDateString(invitation.expiresAt),
      createdAt: toIsoDateString(invitation.createdAt),
      invitedByUserId: invitation.invitedByUserId ?? null,
      respondedByUserId: invitation.respondedByUserId ?? null,
      respondedAt: toIsoDateString(invitation.respondedAt),
    } satisfies z.infer<typeof invitationSchema>;
  };

  const findInvitationRecordById = async (invitationId: string) => {
    const rows = await selectInvitationRecords(eq(dbSchema.invitation.id, invitationId));
    return (rows[0] as InvitationRecord | undefined) ?? null;
  };

  const findPendingInvitationForResend = async ({
    organizationId,
    classroomId,
    subjectKind,
    role,
    email,
  }: {
    organizationId: string;
    classroomId?: string | null;
    subjectKind: InvitationSubjectKind;
    role: UnifiedInvitationRole;
    email: string;
  }) => {
    const rows = await database
      .select(invitationRecordSelection)
      .from(dbSchema.invitation)
      .innerJoin(
        dbSchema.organization,
        eq(dbSchema.organization.id, dbSchema.invitation.organizationId),
      )
      .leftJoin(dbSchema.classroom, eq(dbSchema.classroom.id, dbSchema.invitation.classroomId))
      .where(
        and(
          eq(dbSchema.invitation.organizationId, organizationId),
          eq(dbSchema.invitation.subjectKind, subjectKind),
          eq(dbSchema.invitation.role, role),
          ...(classroomId ? [eq(dbSchema.invitation.classroomId, classroomId)] : []),
          eq(dbSchema.invitation.email, email),
          eq(dbSchema.invitation.status, 'pending'),
        ),
      )
      .limit(1);

    return (rows[0] as InvitationRecord | undefined) ?? null;
  };

  const countInvitationEvent = async ({
    invitationId,
    eventType,
  }: {
    invitationId: string;
    eventType: InvitationEventType;
  }): Promise<number> => {
    const rows = await database
      .select({
        value: sql<number>`count(*)`,
      })
      .from(dbSchema.invitationAuditLog)
      .where(
        and(
          eq(dbSchema.invitationAuditLog.invitationId, invitationId),
          eq(dbSchema.invitationAuditLog.eventType, eventType),
        ),
      );

    return Number(rows[0]?.value ?? 0);
  };

  const writeInvitationEvent = async ({
    invitationId,
    organizationId,
    classroomId,
    actorUserId,
    targetEmail,
    eventType,
    metadata,
    headers,
  }: {
    invitationId: string;
    organizationId: string;
    classroomId?: string | null;
    actorUserId: string;
    targetEmail: string;
    eventType: InvitationEventType;
    metadata?: Record<string, unknown>;
    headers: Headers;
  }) => {
    await database.insert(dbSchema.invitationAuditLog).values({
      id: crypto.randomUUID(),
      invitationId,
      organizationId,
      classroomId: classroomId ?? null,
      actorUserId,
      targetEmail,
      eventType,
      metadata: metadata ? JSON.stringify(metadata) : null,
      ipAddress: getIpAddress(headers),
      userAgent: headers.get('user-agent'),
    });
  };

  const resolveInvitationPrincipalKind = async (
    email: string,
  ): Promise<'email' | 'existing_user'> => {
    const rows = await database
      .select({
        id: dbSchema.user.id,
      })
      .from(dbSchema.user)
      .where(eq(dbSchema.user.email, email))
      .limit(1);

    return rows[0] ? 'existing_user' : 'email';
  };

  const createInvitationRecord = async ({
    subjectKind,
    role,
    organizationId,
    classroomId,
    email,
    participantName,
    invitedByUserId,
  }: {
    subjectKind: InvitationSubjectKind;
    role: UnifiedInvitationRole;
    organizationId: string;
    classroomId?: string | null;
    email: string;
    participantName?: string | null;
    invitedByUserId: string;
  }) => {
    const invitationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 172_800_000);
    await database.insert(dbSchema.invitation).values({
      id: invitationId,
      subjectKind,
      organizationId,
      classroomId: classroomId ?? null,
      email,
      role,
      principalKind: await resolveInvitationPrincipalKind(email),
      participantName: participantName ?? null,
      status: 'pending',
      expiresAt,
      invitedByUserId,
    });

    return findInvitationRecordById(invitationId);
  };

  const sendInvitationEmailForRecord = async ({
    invitation,
    headers,
  }: {
    invitation: InvitationRecord;
    headers: Headers;
  }) => {
    const session = await auth.api.getSession({ headers });
    const inviterName = getStringValue(session?.user?.name);
    const inviterEmail = getStringValue(session?.user?.email);

    if (normalizeInvitationSubjectKind(invitation.subjectKind) === 'participant') {
      if (!invitation.participantName) {
        throw new Error('Participant invitation is missing participantName.');
      }

      await sendParticipantInvitationEmail({
        env,
        invitationId: invitation.id,
        inviteeEmail: invitation.email,
        participantName: invitation.participantName,
        inviterName,
        inviterEmail,
        organizationName: invitation.organizationName,
      });
      return;
    }

    await sendOrganizationInvitationEmail({
      env,
      invitationId: invitation.id,
      inviteeEmail: invitation.email,
      inviterName,
      inviterEmail,
      organizationName: invitation.organizationName,
      role: invitation.role,
    });
  };

  const markInvitationExpiredIfNeeded = async (invitation: InvitationRecord | null) => {
    if (!invitation) {
      return null;
    }

    if (normalizeInvitationStatus(invitation.status, invitation.expiresAt) !== 'expired') {
      return invitation;
    }

    if (invitation.status !== 'expired') {
      await database
        .update(dbSchema.invitation)
        .set({
          status: 'expired',
          updatedAt: new Date(),
        })
        .where(
          and(eq(dbSchema.invitation.id, invitation.id), eq(dbSchema.invitation.status, 'pending')),
        );
      return findInvitationRecordById(invitation.id);
    }

    return invitation;
  };

  const mergeOrganizationInvitationRole = (
    currentRole: string | null,
    invitedRole: 'admin' | 'member',
  ): 'owner' | 'admin' | 'member' => {
    if (currentRole === 'owner') {
      return 'owner';
    }
    if (currentRole === 'admin' || invitedRole === 'admin') {
      return 'admin';
    }
    return 'member';
  };

  const mergeClassroomInvitationRole = (
    currentRole: string | null,
    invitedRole: 'manager' | 'staff',
  ): 'manager' | 'staff' => {
    if (currentRole === 'manager' || invitedRole === 'manager') {
      return 'manager';
    }
    return 'staff';
  };

  const ensureOrganizationMemberFromInvitation = async ({
    tx,
    invitation,
    userId,
  }: {
    tx: AuthRuntimeDatabase;
    invitation: InvitationRecord;
    userId: string;
  }) => {
    const invitedRole = normalizeUnifiedInvitationRole(invitation.role);
    if (invitedRole !== 'admin' && invitedRole !== 'member') {
      throw new Error('Organization invitation role is invalid.');
    }

    const rows = await tx
      .select({
        id: dbSchema.member.id,
        role: dbSchema.member.role,
      })
      .from(dbSchema.member)
      .where(
        and(
          eq(dbSchema.member.organizationId, invitation.organizationId),
          eq(dbSchema.member.userId, userId),
        ),
      )
      .limit(1);

    const existing = rows[0] as { id: string; role: string } | undefined;
    const nextRole = mergeOrganizationInvitationRole(existing?.role ?? null, invitedRole);
    if (existing) {
      if (nextRole !== existing.role) {
        await tx
          .update(dbSchema.member)
          .set({
            role: nextRole,
          })
          .where(eq(dbSchema.member.id, existing.id));
      }
      return existing.id;
    }

    const memberId = crypto.randomUUID();
    await tx.insert(dbSchema.member).values({
      id: memberId,
      organizationId: invitation.organizationId,
      userId,
      role: nextRole,
      createdAt: new Date(),
    });
    return memberId;
  };

  const ensureOrganizationMemberForClassroomOperator = async ({
    tx,
    invitation,
    userId,
  }: {
    tx: AuthRuntimeDatabase;
    invitation: InvitationRecord;
    userId: string;
  }) => {
    const rows = await tx
      .select({
        id: dbSchema.member.id,
      })
      .from(dbSchema.member)
      .where(
        and(
          eq(dbSchema.member.organizationId, invitation.organizationId),
          eq(dbSchema.member.userId, userId),
        ),
      )
      .limit(1);

    const existing = rows[0] as { id: string } | undefined;
    if (existing) {
      return existing.id;
    }

    const memberId = crypto.randomUUID();
    await tx.insert(dbSchema.member).values({
      id: memberId,
      organizationId: invitation.organizationId,
      userId,
      role: 'member',
      createdAt: new Date(),
    });
    return memberId;
  };

  const ensureClassroomMemberFromInvitation = async ({
    tx,
    invitation,
    userId,
  }: {
    tx: AuthRuntimeDatabase;
    invitation: InvitationRecord;
    userId: string;
  }) => {
    const invitedRole = normalizeUnifiedInvitationRole(invitation.role);
    if ((invitedRole !== 'manager' && invitedRole !== 'staff') || !invitation.classroomId) {
      throw new Error('Classroom invitation role is invalid.');
    }

    const rows = await tx
      .select({
        id: dbSchema.classroomMember.id,
        role: dbSchema.classroomMember.role,
      })
      .from(dbSchema.classroomMember)
      .where(
        and(
          eq(dbSchema.classroomMember.classroomId, invitation.classroomId),
          eq(dbSchema.classroomMember.userId, userId),
        ),
      )
      .limit(1);

    const existing = rows[0] as { id: string; role: string } | undefined;
    const nextRole = mergeClassroomInvitationRole(existing?.role ?? null, invitedRole);
    if (existing) {
      if (nextRole !== existing.role) {
        await tx
          .update(dbSchema.classroomMember)
          .set({
            role: nextRole,
          })
          .where(eq(dbSchema.classroomMember.id, existing.id));
      }
      return existing.id;
    }

    const classroomMemberId = crypto.randomUUID();
    await tx.insert(dbSchema.classroomMember).values({
      id: classroomMemberId,
      classroomId: invitation.classroomId,
      userId,
      role: nextRole,
      createdAt: new Date(),
    });
    return classroomMemberId;
  };

  const ensureParticipantFromInvitation = async ({
    tx,
    invitation,
    userId,
  }: {
    tx: AuthRuntimeDatabase;
    invitation: InvitationRecord;
    userId: string;
  }) => {
    if (!invitation.classroomId || !invitation.participantName) {
      throw new Error('Participant invitation is incomplete.');
    }

    const rows = await tx
      .select({
        id: dbSchema.participant.id,
      })
      .from(dbSchema.participant)
      .where(
        and(
          eq(dbSchema.participant.organizationId, invitation.organizationId),
          eq(dbSchema.participant.classroomId, invitation.classroomId),
          or(
            eq(dbSchema.participant.userId, userId),
            eq(dbSchema.participant.email, invitation.email),
          ),
        ),
      )
      .limit(1);

    const existing = rows[0] as { id: string } | undefined;
    if (existing) {
      return existing.id;
    }

    const participantId = crypto.randomUUID();
    await tx.insert(dbSchema.participant).values({
      id: participantId,
      organizationId: invitation.organizationId,
      classroomId: invitation.classroomId,
      userId,
      email: invitation.email,
      name: invitation.participantName,
    });
    return participantId;
  };

  const acceptInvitationRecord = async ({
    invitation,
    userId,
  }: {
    invitation: InvitationRecord;
    userId: string;
  }) => {
    const refreshedRows = await database
      .select({
        id: dbSchema.invitation.id,
        status: dbSchema.invitation.status,
      })
      .from(dbSchema.invitation)
      .where(eq(dbSchema.invitation.id, invitation.id))
      .limit(1);

    const refreshed = refreshedRows[0] as { id: string; status: string } | undefined;
    if (!refreshed || refreshed.status !== 'pending') {
      return null;
    }

    let acceptedMemberId: string | null = null;
    let acceptedClassroomMemberId: string | null = null;
    let acceptedParticipantId: string | null = null;

    const subjectKind = normalizeInvitationSubjectKind(invitation.subjectKind);
    if (subjectKind === 'org_operator') {
      acceptedMemberId = await ensureOrganizationMemberFromInvitation({
        tx: database,
        invitation,
        userId,
      });
    } else if (subjectKind === 'classroom_operator') {
      acceptedMemberId = await ensureOrganizationMemberForClassroomOperator({
        tx: database,
        invitation,
        userId,
      });
      acceptedClassroomMemberId = await ensureClassroomMemberFromInvitation({
        tx: database,
        invitation,
        userId,
      });
    } else if (subjectKind === 'participant') {
      acceptedParticipantId = await ensureParticipantFromInvitation({
        tx: database,
        invitation,
        userId,
      });
    } else {
      throw new Error('Invitation subjectKind is invalid.');
    }

    const updateResult = await database
      .update(dbSchema.invitation)
      .set({
        status: 'accepted',
        respondedByUserId: userId,
        respondedAt: new Date(),
        acceptedMemberId,
        acceptedClassroomMemberId,
        acceptedParticipantId,
      })
      .where(
        and(eq(dbSchema.invitation.id, invitation.id), eq(dbSchema.invitation.status, 'pending')),
      );

    const updatedCount = Number(
      (
        updateResult as {
          rowsAffected?: number;
          meta?: { changes?: number };
        }
      ).rowsAffected ??
        (
          updateResult as {
            rowsAffected?: number;
            meta?: { changes?: number };
          }
        ).meta?.changes ??
        0,
    );
    if (updatedCount === 0) {
      return null;
    }

    return {
      memberId: acceptedMemberId,
      classroomMemberId: acceptedClassroomMemberId,
      participantId: acceptedParticipantId,
    };
  };

  const resolveClassroomContextBySlugs = async ({
    orgSlug,
    classroomSlug,
  }: {
    orgSlug: string;
    classroomSlug: string;
  }) => {
    return resolveOrganizationClassroomContext({
      database,
      organizationSlug: orgSlug,
      classroomSlug,
    });
  };

  const resolveClassroomContextByOrganizationId = async (organizationId: string) => {
    return resolveOrganizationClassroomContext({
      database,
      organizationId,
    });
  };

  const resolveClassroomContextByIds = async ({
    organizationId,
    classroomId,
  }: {
    organizationId: string;
    classroomId: string;
  }) => {
    const rows = await database
      .select({
        organizationId: dbSchema.organization.id,
        organizationSlug: dbSchema.organization.slug,
        organizationName: dbSchema.organization.name,
        classroomId: dbSchema.classroom.id,
        classroomSlug: dbSchema.classroom.slug,
        classroomName: dbSchema.classroom.name,
      })
      .from(dbSchema.classroom)
      .innerJoin(
        dbSchema.organization,
        eq(dbSchema.organization.id, dbSchema.classroom.organizationId),
      )
      .where(
        and(
          eq(dbSchema.classroom.organizationId, organizationId),
          eq(dbSchema.classroom.id, classroomId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  };

  const resolveOrganizationBySlug = async (orgSlug: string) => {
    const rows = await database
      .select({
        id: dbSchema.organization.id,
        slug: dbSchema.organization.slug,
        name: dbSchema.organization.name,
      })
      .from(dbSchema.organization)
      .where(eq(dbSchema.organization.slug, orgSlug))
      .limit(1);

    return rows[0] ?? null;
  };

  const serializeManagedClassroom = async ({
    context,
    userId,
  }: {
    context: Awaited<ReturnType<typeof resolveOrganizationClassroomContext>>;
    userId: string;
  }) => {
    if (!context) {
      return null;
    }

    const access = await resolveOrganizationClassroomAccess({
      database,
      userId,
      context,
    });

    if (
      !access.display.primaryRole &&
      !access.effective.canUseParticipantBooking &&
      !access.effective.canManageClassroom
    ) {
      return null;
    }

    return {
      id: context.classroomId,
      slug: context.classroomSlug,
      name: context.classroomName,
      logo: null,
      facts: access.facts,
      effective: access.effective,
      sources: access.sources,
      display: access.display,
    };
  };

  const listAccessibleClassroomsForOrganization = async ({
    organizationSlug,
    userId,
  }: {
    organizationSlug: string;
    userId: string;
  }) => {
    const organization = await resolveOrganizationBySlug(organizationSlug);
    if (!organization) {
      return {
        organization: null,
        classrooms: [] as Array<z.infer<typeof classroomManagementSchema>>,
      };
    }

    const [memberRows, classroomMemberRows, participantRows] = await Promise.all([
      database
        .select({
          role: dbSchema.member.role,
        })
        .from(dbSchema.member)
        .where(
          and(
            eq(dbSchema.member.organizationId, organization.id),
            eq(dbSchema.member.userId, userId),
          ),
        )
        .limit(1),
      database
        .select({
          classroomId: dbSchema.classroomMember.classroomId,
        })
        .from(dbSchema.classroomMember)
        .innerJoin(
          dbSchema.classroom,
          eq(dbSchema.classroom.id, dbSchema.classroomMember.classroomId),
        )
        .where(
          and(
            eq(dbSchema.classroom.organizationId, organization.id),
            eq(dbSchema.classroomMember.userId, userId),
          ),
        ),
      database
        .select({
          classroomId: dbSchema.participant.classroomId,
        })
        .from(dbSchema.participant)
        .where(
          and(
            eq(dbSchema.participant.organizationId, organization.id),
            eq(dbSchema.participant.userId, userId),
          ),
        ),
    ]);

    const organizationRole = memberRows[0]?.role;
    const hasOrganizationAccess =
      organizationRole === 'owner' ||
      organizationRole === 'admin' ||
      organizationRole === 'member' ||
      classroomMemberRows.length > 0 ||
      participantRows.length > 0;

    if (!hasOrganizationAccess) {
      return { organization, classrooms: [] as Array<z.infer<typeof classroomManagementSchema>> };
    }

    const classroomContexts =
      organizationRole === 'owner' || organizationRole === 'admin'
        ? await listOrganizationClassroomContexts({
            database,
            organizationId: organization.id,
          })
        : (
            await Promise.all(
              Array.from(
                new Set([
                  ...classroomMemberRows.map(
                    (row: (typeof classroomMemberRows)[number]) => row.classroomId,
                  ),
                  ...participantRows.map(
                    (row: (typeof participantRows)[number]) => row.classroomId,
                  ),
                ]),
              ).map((classroomId) =>
                resolveClassroomContextByIds({
                  organizationId: organization.id,
                  classroomId,
                }),
              ),
            )
          ).filter((context): context is NonNullable<typeof context> => Boolean(context));

    const classrooms = (
      await Promise.all(
        classroomContexts.map((context) =>
          serializeManagedClassroom({
            context,
            userId,
          }),
        ),
      )
    )
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((left, right) => left.name.localeCompare(right.name));

    return { organization, classrooms };
  };

  const hydrateInvitationRecord = async (invitationId: string) => {
    const invitation = await markInvitationExpiredIfNeeded(
      await findInvitationRecordById(invitationId),
    );
    return invitation;
  };

  const listSerializedInvitations = async (whereClause: SQL<unknown> | undefined) => {
    const invitations = await selectInvitationRecords(whereClause);
    const serialized: Array<z.infer<typeof invitationSchema>> = [];

    for (const invitation of invitations as InvitationRecord[]) {
      const hydrated = await markInvitationExpiredIfNeeded(invitation);
      const next = serializeInvitation(hydrated);
      if (next) {
        serialized.push(next);
      }
    }

    return serialized;
  };

  const isInvitationRecipient = ({
    invitation,
    email,
  }: {
    invitation: InvitationRecord;
    email: string | null;
  }) => {
    return Boolean(email && normalizeEmail(invitation.email) === email);
  };

  const canCancelInvitation = async ({
    invitation,
    userId,
  }: {
    invitation: InvitationRecord;
    userId: string;
  }) => {
    if (invitation.invitedByUserId === userId) {
      return true;
    }

    const subjectKind = normalizeInvitationSubjectKind(invitation.subjectKind);
    if (subjectKind === 'org_operator') {
      return hasOrganizationAdminAccess({
        organizationId: invitation.organizationId,
        userId,
      });
    }

    if (!invitation.classroomId) {
      return false;
    }

    const classroomContext = await resolveClassroomContextByIds({
      organizationId: invitation.organizationId,
      classroomId: invitation.classroomId,
    });
    if (!classroomContext) {
      return false;
    }

    const access = await resolveOrganizationClassroomAccess({
      database,
      userId,
      context: classroomContext,
    });
    if (subjectKind === 'participant') {
      return access.effective.canManageParticipants || access.effective.canManageClassroom;
    }

    return access.effective.canManageClassroom;
  };

  authRoutes.use('/session', async (c, next) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      c.set('user', null);
      c.set('session', null);
      await next();
      return;
    }

    c.set('user', session.user as Record<string, unknown>);
    c.set('session', session.session as Record<string, unknown>);
    await next();
  });

  authRoutes.openapi(signUpRoute, async (c) => {
    const body = c.req.valid('json');
    return auth.api.signUpEmail({
      body,
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(signInRoute, async (c) => {
    const body = c.req.valid('json');
    return auth.api.signInEmail({
      body,
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(signOutRoute, async (c) => {
    return auth.api.signOut({
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(googleOidcRoute, async (c) => {
    const query = c.req.valid('query');

    const response = await auth.api.signInSocial({
      body: {
        provider: 'google',
        callbackURL: query.callbackURL,
        errorCallbackURL: query.errorCallbackURL,
        newUserCallbackURL: query.newUserCallbackURL,
        disableRedirect: query.disableRedirect,
      },
      headers: c.req.raw.headers,
      asResponse: true,
    });

    // Better Auth returns 200 + { url, redirect } for social sign-in starts.
    // Convert to an actual 302 for browser navigation unless explicitly disabled.
    if (query.disableRedirect === true) {
      const headers = new Headers(response.headers);
      appendLegacyOAuthStateCleanupCookie(headers);
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    if (!response.ok) {
      const headers = new Headers(response.headers);
      appendLegacyOAuthStateCleanupCookie(headers);
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    const location = response.headers.get('location');
    if (!location) {
      const headers = new Headers(response.headers);
      appendLegacyOAuthStateCleanupCookie(headers);
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    const headers = new Headers(response.headers);
    headers.delete('content-type');
    headers.delete('content-length');
    appendLegacyOAuthStateCleanupCookie(headers);

    return new Response(null, {
      status: 302,
      headers,
    });
  });

  authRoutes.openapi(sessionRoute, (c) => {
    const user = c.get('user');
    const session = c.get('session');

    if (!user || !session) {
      return c.json(null, 200);
    }

    return c.json({ user, session }, 200);
  });

  authRoutes.post('/organizations/logo', async (c) => {
    if (!organizationLogoService) {
      return c.json({ message: 'Organization logo upload is not configured.' }, 503);
    }

    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    const userId = session?.user?.id;
    if (typeof userId !== 'string' || userId.length === 0) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    let formData: FormData;
    try {
      formData = await c.req.raw.formData();
    } catch {
      return c.json({ message: 'Invalid multipart form-data request.' }, 400);
    }

    const file = formData.get('file');
    if (!isFileEntry(file)) {
      return c.json({ message: 'Image file is required.' }, 400);
    }

    try {
      const uploaded = await organizationLogoService.upload({
        file,
        ownerUserId: userId,
      });

      return c.json(uploaded, 201);
    } catch (error) {
      const message =
        error instanceof Error && error.message.length > 0
          ? error.message
          : 'Failed to upload organization logo.';
      return c.json({ message }, 400);
    }
  });

  authRoutes.get('/organizations/logo/:key', async (c) => {
    if (!organizationLogoService) {
      return c.text('Organization logo delivery is not configured.', 503);
    }

    const key = c.req.param('key');
    if (!LOGO_KEY_PATTERN.test(key)) {
      return c.json({ message: 'Invalid logo key.' }, 400);
    }

    const object = await organizationLogoService.get(key);
    if (!object) {
      return c.text('Logo not found.', 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata?.(headers);

    headers.set('content-type', object.httpMetadata?.contentType ?? 'image/webp');
    headers.set(
      'cache-control',
      object.httpMetadata?.cacheControl ?? 'public, max-age=31536000, immutable',
    );

    return new Response(object.body, {
      status: 200,
      headers,
    });
  });

  authRoutes.openapi(createOrganizationRoute, (c) => {
    return (async () => {
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const canCreateOrganization = await canCreateOrganizationForIdentity(identity);
      if (!canCreateOrganization) {
        return c.json(
          {
            message: '招待参加ユーザーは組織を作成できません。招待先の組織に参加してください。',
          },
          403,
        );
      }

      const body = c.req.valid('json');

      const response = await auth.api.createOrganization({
        body,
        headers: c.req.raw.headers,
        asResponse: true,
      });
      if (!response.ok) {
        return response;
      }

      const payload = (await response
        .clone()
        .json()
        .catch(() => null)) as Record<string, unknown> | null;
      const organizationId =
        typeof payload?.id === 'string' && payload.id.length > 0 ? payload.id : null;
      const organizationName =
        typeof payload?.name === 'string' && payload.name.length > 0 ? payload.name : body.name;

      if (organizationId) {
        await database
          .insert(dbSchema.classroom)
          .values({
            id: organizationId,
            organizationId,
            slug: body.slug,
            name: organizationName,
          })
          .onConflictDoNothing();

        await ensureOrganizationBillingRow(database, organizationId);
      }

      return response;
    })();
  });

  authRoutes.openapi(listOrganizationsRoute, (c) => {
    return auth.api.listOrganizations({
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

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

      const priceId =
        body.billingInterval === 'month'
          ? env.STRIPE_PREMIUM_MONTHLY_PRICE_ID?.trim()
          : env.STRIPE_PREMIUM_YEARLY_PRICE_ID?.trim();
      if (!env.STRIPE_SECRET_KEY?.trim() || !priceId) {
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

      const webBaseUrl = (env.WEB_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
      const contractsUrl = `${webBaseUrl}/admin/contracts`;
      try {
        const session = await createSubscriptionCheckoutSession({
          env,
          priceId,
          successUrl: `${contractsUrl}?subscription=success`,
          cancelUrl: `${contractsUrl}?subscription=cancel`,
          customerId: billing?.stripeCustomerId ?? null,
          clientReferenceId: organizationId,
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
          stripeCustomerId: billing?.stripeCustomerId ?? null,
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

      const operation = await createBillingOperationAttempt({
        database,
        organizationId,
        purpose: 'trial_start',
        createdByUserId: identity.userId,
      });
      const previousBillingSnapshot = await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId,
      });
      const defaultTrialPrice = resolveDefaultPremiumTrialPriceConfig();
      let stripeCustomerId = billing?.stripeCustomerId ?? null;
      let stripeSubscriptionId: string | null = null;
      let stripePriceId: string | null = null;
      let billingInterval: 'month' | 'year' | null = null;
      let trialStartedAt: Date | undefined;
      let trialEndsAt: Date | undefined;

      if (env.STRIPE_SECRET_KEY?.trim() && defaultTrialPrice) {
        if (!stripeCustomerId) {
          const customer = await createCustomer({
            env,
            idempotencyKey: `${operation.attempt.idempotencyKey}:customer`,
            metadata: {
              billingPurpose: 'organization_trial',
              organizationId,
              billingOperationAttemptId: operation.attempt.id,
            },
          });
          stripeCustomerId = customer.id;
        }

        const subscription = await createTrialSubscription({
          env,
          customerId: stripeCustomerId,
          priceId: defaultTrialPrice.priceId,
          trialPeriodDays: ORGANIZATION_PREMIUM_TRIAL_DURATION_DAYS,
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

      let customerId = billing.stripeCustomerId;
      if (!customerId) {
        const previousBillingSnapshot = await readOrganizationBillingObservationSnapshot({
          database,
          env,
          organizationId,
        });
        const customer = await createCustomer({
          env,
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
      const session = await createSetupCheckoutSession({
        env,
        customerId,
        successUrl: `${contractsUrl}?paymentMethod=success`,
        cancelUrl: `${contractsUrl}?paymentMethod=cancel`,
        clientReferenceId: organizationId,
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

      const webBaseUrl = (env.WEB_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
      const contractsUrl = `${webBaseUrl}/admin/contracts`;
      const portalSession = await createBillingPortalSession({
        env,
        customerId: billing.stripeCustomerId,
        returnUrl: contractsUrl,
        idempotencyKey: operation.attempt.idempotencyKey,
        subscriptionUpdate: {
          subscriptionId: billing.stripeSubscriptionId,
          afterCompletionReturnUrl: `${contractsUrl}?subscription=success`,
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

  authRoutes.openapi(listOrganizationClassroomsRoute, (c) => {
    return (async () => {
      const { orgSlug } = c.req.valid('param');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const result = await listAccessibleClassroomsForOrganization({
        organizationSlug: orgSlug,
        userId: identity.userId,
      });
      if (!result.organization) {
        return c.json({ message: 'Organization not found.' }, 404);
      }
      if (result.classrooms.length === 0) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      return c.json(result.classrooms, 200);
    })();
  });

  authRoutes.openapi(createClassroomRoute, (c) => {
    return (async () => {
      const { orgSlug } = c.req.valid('param');
      const body = c.req.valid('json');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organization = await resolveOrganizationBySlug(orgSlug);
      if (!organization) {
        return c.json({ message: 'Organization not found.' }, 404);
      }

      const organizationContext = await resolveClassroomContextByOrganizationId(organization.id);
      if (!organizationContext) {
        return c.json({ message: 'Organization or classroom not found.' }, 404);
      }

      const access = await resolveOrganizationClassroomAccess({
        database,
        userId: identity.userId,
        context: organizationContext,
      });
      if (!access.effective.canManageOrganization) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const premiumGate = await readOrganizationPremiumFeatureGate({
        database,
        env,
        organizationId: organization.id,
      });
      if (!premiumGate.allowed) {
        return c.json(premiumGate.body, premiumGate.status);
      }

      const slug = body.slug.trim();
      const name = body.name.trim();
      const duplicateRows = await database
        .select({ id: dbSchema.classroom.id })
        .from(dbSchema.classroom)
        .where(
          and(
            eq(dbSchema.classroom.organizationId, organization.id),
            eq(dbSchema.classroom.slug, slug),
          ),
        )
        .limit(1);
      if (duplicateRows[0]) {
        return c.json({ message: 'Classroom slug already exists.' }, 409);
      }

      const classroomId = crypto.randomUUID();
      await database.insert(dbSchema.classroom).values({
        id: classroomId,
        organizationId: organization.id,
        slug,
        name,
      });

      const classroomContext = await resolveClassroomContextByIds({
        organizationId: organization.id,
        classroomId,
      });
      const serialized = await serializeManagedClassroom({
        context: classroomContext,
        userId: identity.userId,
      });

      return c.json(
        serialized ?? {
          id: classroomId,
          slug,
          name,
          logo: null,
          facts: {
            orgRole: access.facts.orgRole,
            classroomStaffRole: null,
            hasParticipantRecord: false,
          },
          effective: {
            canManageOrganization: true,
            canManageClassroom: true,
            canManageBookings: true,
            canManageParticipants: true,
            canUseParticipantBooking: false,
          },
          sources: {
            canManageOrganization: 'org_role',
            canManageClassroom: 'org_role',
            canManageBookings: 'org_role',
            canManageParticipants: 'org_role',
            canUseParticipantBooking: null,
          },
          display: {
            primaryRole: access.display.primaryRole,
            badges: access.display.badges,
          },
        },
        200,
      );
    })();
  });

  authRoutes.openapi(updateClassroomRoute, (c) => {
    return (async () => {
      const { orgSlug, classroomSlug } = c.req.valid('param');
      const body = c.req.valid('json');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const classroomContext = await resolveClassroomContextBySlugs({ orgSlug, classroomSlug });
      if (!classroomContext) {
        return c.json({ message: 'Organization or classroom not found.' }, 404);
      }

      const access = await resolveOrganizationClassroomAccess({
        database,
        userId: identity.userId,
        context: classroomContext,
      });
      if (!access.effective.canManageOrganization) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const nextSlug = body.slug.trim();
      const nextName = body.name.trim();
      const duplicateRows = await database
        .select({ id: dbSchema.classroom.id })
        .from(dbSchema.classroom)
        .where(
          and(
            eq(dbSchema.classroom.organizationId, classroomContext.organizationId),
            eq(dbSchema.classroom.slug, nextSlug),
          ),
        )
        .limit(1);
      if (duplicateRows[0] && duplicateRows[0].id !== classroomContext.classroomId) {
        return c.json({ message: 'Classroom slug already exists.' }, 409);
      }

      await database
        .update(dbSchema.classroom)
        .set({
          slug: nextSlug,
          name: nextName,
          updatedAt: new Date(),
        })
        .where(eq(dbSchema.classroom.id, classroomContext.classroomId));

      const updatedContext = await resolveClassroomContextByIds({
        organizationId: classroomContext.organizationId,
        classroomId: classroomContext.classroomId,
      });
      const serialized = await serializeManagedClassroom({
        context: updatedContext,
        userId: identity.userId,
      });
      if (!serialized) {
        return c.json({ message: 'Classroom not found.' }, 404);
      }

      return c.json(serialized, 200);
    })();
  });

  authRoutes.openapi(listOrganizationAccessTreeRoute, (c) => {
    return (async () => {
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const [memberRows, participantRows] = await Promise.all([
        database
          .select({
            organizationId: dbSchema.member.organizationId,
            organizationSlug: dbSchema.organization.slug,
            organizationName: dbSchema.organization.name,
            organizationLogo: dbSchema.organization.logo,
            role: dbSchema.member.role,
          })
          .from(dbSchema.member)
          .innerJoin(
            dbSchema.organization,
            eq(dbSchema.organization.id, dbSchema.member.organizationId),
          )
          .where(eq(dbSchema.member.userId, identity.userId)),
        database
          .select({
            organizationId: dbSchema.participant.organizationId,
            classroomId: dbSchema.participant.classroomId,
            organizationSlug: dbSchema.organization.slug,
            organizationName: dbSchema.organization.name,
            organizationLogo: dbSchema.organization.logo,
          })
          .from(dbSchema.participant)
          .innerJoin(
            dbSchema.organization,
            eq(dbSchema.organization.id, dbSchema.participant.organizationId),
          )
          .where(eq(dbSchema.participant.userId, identity.userId)),
      ]);

      const classroomMemberRows = await database
        .select({
          organizationId: dbSchema.classroom.organizationId,
          organizationSlug: dbSchema.organization.slug,
          organizationName: dbSchema.organization.name,
          organizationLogo: dbSchema.organization.logo,
          classroomId: dbSchema.classroom.id,
          role: dbSchema.classroomMember.role,
        })
        .from(dbSchema.classroomMember)
        .innerJoin(
          dbSchema.classroom,
          eq(dbSchema.classroom.id, dbSchema.classroomMember.classroomId),
        )
        .innerJoin(
          dbSchema.organization,
          eq(dbSchema.organization.id, dbSchema.classroom.organizationId),
        )
        .where(eq(dbSchema.classroomMember.userId, identity.userId));

      const organizationsById = new Map<
        string,
        {
          organizationId: string;
          organizationSlug: string;
          organizationName: string;
          organizationLogo: string | null;
          organizationRole: 'owner' | 'admin' | 'member' | null;
        }
      >();
      for (const row of memberRows) {
        organizationsById.set(row.organizationId, {
          organizationId: row.organizationId,
          organizationSlug: row.organizationSlug,
          organizationName: row.organizationName,
          organizationLogo: row.organizationLogo,
          organizationRole:
            row.role === 'owner' || row.role === 'admin' || row.role === 'member' ? row.role : null,
        });
      }
      for (const row of participantRows) {
        organizationsById.set(row.organizationId, {
          organizationId: row.organizationId,
          organizationSlug: row.organizationSlug,
          organizationName: row.organizationName,
          organizationLogo: row.organizationLogo,
          organizationRole: organizationsById.get(row.organizationId)?.organizationRole ?? null,
        });
      }
      for (const row of classroomMemberRows) {
        organizationsById.set(row.organizationId, {
          organizationId: row.organizationId,
          organizationSlug: row.organizationSlug,
          organizationName: row.organizationName,
          organizationLogo: row.organizationLogo,
          organizationRole: organizationsById.get(row.organizationId)?.organizationRole ?? null,
        });
      }

      const tree: Array<z.infer<typeof accessTreeOrganizationSchema>> = [];
      for (const row of organizationsById.values()) {
        const allClassroomContexts =
          row.organizationRole === 'owner' || row.organizationRole === 'admin'
            ? await listOrganizationClassroomContexts({
                database,
                organizationId: row.organizationId,
              })
            : [];

        const accessibleClassroomIds = new Set<string>();
        for (const classroomRow of classroomMemberRows) {
          if (classroomRow.organizationId === row.organizationId) {
            accessibleClassroomIds.add(classroomRow.classroomId);
          }
        }
        for (const participantRow of participantRows) {
          if (participantRow.organizationId === row.organizationId) {
            accessibleClassroomIds.add(participantRow.classroomId);
          }
        }

        const classroomContexts =
          allClassroomContexts.length > 0
            ? allClassroomContexts
            : (
                await Promise.all(
                  Array.from(accessibleClassroomIds).map(async (classroomId) =>
                    resolveOrganizationClassroomContext({
                      database,
                      organizationId: row.organizationId,
                    }).then(async (fallbackContext) => {
                      if (fallbackContext?.classroomId === classroomId) {
                        return fallbackContext;
                      }
                      const classroomRows = await database
                        .select({
                          id: dbSchema.classroom.id,
                          slug: dbSchema.classroom.slug,
                          name: dbSchema.classroom.name,
                        })
                        .from(dbSchema.classroom)
                        .where(
                          and(
                            eq(dbSchema.classroom.organizationId, row.organizationId),
                            eq(dbSchema.classroom.id, classroomId),
                          ),
                        )
                        .limit(1);
                      const classroom = classroomRows[0];
                      return classroom
                        ? {
                            organizationId: row.organizationId,
                            organizationSlug: row.organizationSlug,
                            organizationName: row.organizationName,
                            classroomId: classroom.id,
                            classroomSlug: classroom.slug,
                            classroomName: classroom.name,
                          }
                        : null;
                    }),
                  ),
                )
              ).filter((context): context is NonNullable<typeof context> => Boolean(context));

        const classrooms = [];
        for (const context of classroomContexts) {
          const access = await resolveOrganizationClassroomAccess({
            database,
            userId: identity.userId,
            context,
          });
          if (
            !access.display.primaryRole &&
            !access.effective.canUseParticipantBooking &&
            !access.effective.canManageClassroom
          ) {
            continue;
          }
          classrooms.push({
            id: context.classroomId,
            slug: context.classroomSlug,
            name: context.classroomName,
            logo: null,
            facts: access.facts,
            effective: access.effective,
            sources: access.sources,
            display: access.display,
          });
        }

        if (classrooms.length === 0) {
          continue;
        }

        classrooms.sort((left, right) => left.name.localeCompare(right.name));
        tree.push({
          org: {
            id: row.organizationId,
            slug: row.organizationSlug,
            name: row.organizationName,
            logo: row.organizationLogo,
          },
          facts: {
            orgRole: row.organizationRole,
          },
          classrooms,
        });
      }

      tree.sort((left, right) => left.org.name.localeCompare(right.org.name));
      return c.json({ orgs: tree }, 200);
    })();
  });

  authRoutes.openapi(setActiveOrganizationRoute, (c) => {
    const body = c.req.valid('json');

    return auth.api.setActiveOrganization({
      body,
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(getFullOrganizationRoute, (c) => {
    const query = c.req.valid('query');

    return auth.api.getFullOrganization({
      query,
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(createOrganizationInvitationRoute, (c) => {
    return (async () => {
      const { orgSlug } = c.req.valid('param');
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organization = await resolveOrganizationBySlug(orgSlug);
      if (!organization) {
        return c.json({ message: 'Organization not found.' }, 404);
      }

      const hasAccess = await hasOrganizationAdminAccess({
        organizationId: organization.id,
        userId: identity.userId,
      });
      if (!hasAccess) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const premiumGate = await readOrganizationPremiumFeatureGate({
        database,
        env,
        organizationId: organization.id,
      });
      if (!premiumGate.allowed) {
        return c.json(premiumGate.body, premiumGate.status);
      }

      const normalizedEmail = normalizeEmail(body.email);
      const pendingInvitation = await markInvitationExpiredIfNeeded(
        await findPendingInvitationForResend({
          organizationId: organization.id,
          subjectKind: 'org_operator',
          role: body.role,
          email: normalizedEmail,
        }),
      );
      const pendingSerialized = serializeInvitation(pendingInvitation);

      if (body.resend) {
        if (!pendingInvitation || pendingSerialized?.status !== 'pending') {
          return c.json({ message: 'Pending invitation for resend was not found.' }, 400);
        }

        const resentCount = await countInvitationEvent({
          invitationId: pendingInvitation.id,
          eventType: 'resent',
        });
        if (resentCount >= 3) {
          return c.json({ message: 'Invitation resend limit reached (3).' }, 429);
        }

        await sendInvitationEmailForRecord({
          invitation: pendingInvitation,
          headers,
        });
        await writeInvitationEvent({
          invitationId: pendingInvitation.id,
          organizationId: pendingInvitation.organizationId,
          actorUserId: identity.userId,
          targetEmail: pendingInvitation.email,
          eventType: 'resent',
          metadata: {
            subjectKind: 'org_operator',
            role: body.role,
          },
          headers,
        });

        return c.json(pendingSerialized, 200);
      }

      if (pendingInvitation && pendingSerialized?.status === 'pending') {
        return c.json({ message: 'Pending invitation already exists for this email.' }, 409);
      }

      const createdInvitation = await createInvitationRecord({
        subjectKind: 'org_operator',
        role: body.role,
        organizationId: organization.id,
        email: normalizedEmail,
        invitedByUserId: identity.userId,
      });
      if (!createdInvitation) {
        return c.json({ message: 'Failed to create invitation.' }, 500);
      }

      const serializedInvitation = serializeInvitation(createdInvitation);
      if (!serializedInvitation) {
        return c.json({ message: 'Failed to serialize invitation.' }, 500);
      }

      await sendInvitationEmailForRecord({
        invitation: createdInvitation,
        headers,
      });
      await writeInvitationEvent({
        invitationId: createdInvitation.id,
        organizationId: createdInvitation.organizationId,
        actorUserId: identity.userId,
        targetEmail: createdInvitation.email,
        eventType: 'created',
        metadata: {
          subjectKind: 'org_operator',
          role: body.role,
        },
        headers,
      });

      return c.json(serializedInvitation, 200);
    })();
  });

  authRoutes.openapi(listOrganizationInvitationsRoute, (c) => {
    return (async () => {
      const { orgSlug } = c.req.valid('param');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organization = await resolveOrganizationBySlug(orgSlug);
      if (!organization) {
        return c.json({ message: 'Organization not found.' }, 404);
      }

      const hasAccess = await hasOrganizationAdminAccess({
        organizationId: organization.id,
        userId: identity.userId,
      });
      if (!hasAccess) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const premiumGate = await readOrganizationPremiumFeatureGate({
        database,
        env,
        organizationId: organization.id,
      });
      if (!premiumGate.allowed) {
        return c.json(premiumGate.body, premiumGate.status);
      }

      const invitations = await listSerializedInvitations(
        and(
          eq(dbSchema.invitation.organizationId, organization.id),
          eq(dbSchema.invitation.subjectKind, 'org_operator'),
        ),
      );
      return c.json(invitations, 200);
    })();
  });

  authRoutes.openapi(createClassroomInvitationRoute, (c) => {
    return (async () => {
      const { orgSlug, classroomSlug } = c.req.valid('param');
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const classroomContext = await resolveClassroomContextBySlugs({ orgSlug, classroomSlug });
      if (!classroomContext) {
        return c.json({ message: 'Organization or classroom not found.' }, 404);
      }

      const access = await resolveOrganizationClassroomAccess({
        database,
        userId: identity.userId,
        context: classroomContext,
      });

      const normalizedEmail = normalizeEmail(body.email);
      const subjectKind: InvitationSubjectKind =
        body.role === 'participant' ? 'participant' : 'classroom_operator';

      if (subjectKind === 'participant') {
        if (!access.effective.canManageParticipants) {
          return c.json({ message: 'Forbidden' }, 403);
        }
        if (!body.participantName || body.participantName.trim().length === 0) {
          return c.json(
            { message: 'participantName is required for participant invitations.' },
            400,
          );
        }
      } else if (!access.effective.canManageClassroom) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const premiumGate = await readOrganizationPremiumFeatureGate({
        database,
        env,
        organizationId: classroomContext.organizationId,
      });
      if (!premiumGate.allowed) {
        return c.json(premiumGate.body, premiumGate.status);
      }

      const pendingInvitation = await markInvitationExpiredIfNeeded(
        await findPendingInvitationForResend({
          organizationId: classroomContext.organizationId,
          classroomId: classroomContext.classroomId,
          subjectKind,
          role: body.role,
          email: normalizedEmail,
        }),
      );
      const pendingSerialized = serializeInvitation(pendingInvitation);

      if (body.resend) {
        if (!pendingInvitation || pendingSerialized?.status !== 'pending') {
          return c.json({ message: 'Pending invitation for resend was not found.' }, 400);
        }

        const resentCount = await countInvitationEvent({
          invitationId: pendingInvitation.id,
          eventType: 'resent',
        });
        if (resentCount >= 3) {
          return c.json({ message: 'Invitation resend limit reached (3).' }, 429);
        }

        await sendInvitationEmailForRecord({
          invitation: pendingInvitation,
          headers,
        });
        await writeInvitationEvent({
          invitationId: pendingInvitation.id,
          organizationId: pendingInvitation.organizationId,
          classroomId: pendingInvitation.classroomId,
          actorUserId: identity.userId,
          targetEmail: pendingInvitation.email,
          eventType: 'resent',
          metadata: {
            subjectKind,
            role: body.role,
            classroomSlug: classroomContext.classroomSlug,
          },
          headers,
        });

        return c.json(pendingSerialized, 200);
      }

      if (pendingInvitation && pendingSerialized?.status === 'pending') {
        return c.json({ message: 'Pending invitation already exists for this email.' }, 409);
      }

      const createdInvitation = await createInvitationRecord({
        subjectKind,
        role: body.role,
        organizationId: classroomContext.organizationId,
        classroomId: classroomContext.classroomId,
        email: normalizedEmail,
        participantName:
          body.role === 'participant' ? (body.participantName?.trim() ?? null) : null,
        invitedByUserId: identity.userId,
      });
      if (!createdInvitation) {
        return c.json({ message: 'Failed to create invitation.' }, 500);
      }

      const serializedInvitation = serializeInvitation(createdInvitation);
      if (!serializedInvitation) {
        return c.json({ message: 'Failed to serialize invitation.' }, 500);
      }

      await sendInvitationEmailForRecord({
        invitation: createdInvitation,
        headers,
      });
      await writeInvitationEvent({
        invitationId: createdInvitation.id,
        organizationId: createdInvitation.organizationId,
        classroomId: createdInvitation.classroomId,
        actorUserId: identity.userId,
        targetEmail: createdInvitation.email,
        eventType: 'created',
        metadata: {
          subjectKind,
          role: body.role,
          classroomSlug: classroomContext.classroomSlug,
          participantName:
            body.role === 'participant' ? (body.participantName?.trim() ?? null) : null,
        },
        headers,
      });

      return c.json(serializedInvitation, 200);
    })();
  });

  authRoutes.openapi(listClassroomInvitationsRoute, (c) => {
    return (async () => {
      const { orgSlug, classroomSlug } = c.req.valid('param');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const classroomContext = await resolveClassroomContextBySlugs({ orgSlug, classroomSlug });
      if (!classroomContext) {
        return c.json({ message: 'Organization or classroom not found.' }, 404);
      }

      const access = await resolveOrganizationClassroomAccess({
        database,
        userId: identity.userId,
        context: classroomContext,
      });
      if (!access.effective.canManageParticipants && !access.effective.canManageClassroom) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const premiumGate = await readOrganizationPremiumFeatureGate({
        database,
        env,
        organizationId: classroomContext.organizationId,
      });
      if (!premiumGate.allowed) {
        return c.json(premiumGate.body, premiumGate.status);
      }

      const invitations = await listSerializedInvitations(
        and(
          eq(dbSchema.invitation.organizationId, classroomContext.organizationId),
          eq(dbSchema.invitation.classroomId, classroomContext.classroomId),
        ),
      );
      const filteredInvitations = invitations.filter((invitation) => {
        if (invitation.subjectKind === 'participant') {
          return access.effective.canManageParticipants || access.effective.canManageClassroom;
        }

        return access.effective.canManageClassroom;
      });

      return c.json(filteredInvitations, 200);
    })();
  });

  authRoutes.openapi(listUserInvitationsRoute, (c) => {
    return (async () => {
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }

      const invitations = await listSerializedInvitations(
        eq(dbSchema.invitation.email, identity.email),
      );
      return c.json(invitations, 200);
    })();
  });

  authRoutes.openapi(invitationDetailRoute, (c) => {
    return (async () => {
      const { invitationId } = c.req.valid('param');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }

      const invitation = await hydrateInvitationRecord(invitationId);
      if (!invitation) {
        return c.json({ message: 'Invitation not found.' }, 404);
      }
      if (!isInvitationRecipient({ invitation, email: identity.email })) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const serializedInvitation = serializeInvitation(invitation);
      if (!serializedInvitation) {
        return c.json({ message: 'Invitation not found.' }, 404);
      }

      return c.json(serializedInvitation, 200);
    })();
  });

  authRoutes.openapi(acceptInvitationRoute, (c) => {
    return (async () => {
      const { invitationId } = c.req.valid('param');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }

      const invitation = await hydrateInvitationRecord(invitationId);
      if (!invitation) {
        return c.json({ message: 'Invitation not found.' }, 404);
      }
      if (!isInvitationRecipient({ invitation, email: identity.email })) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      if (
        invitation.subjectKind === 'org_operator' ||
        invitation.subjectKind === 'classroom_operator'
      ) {
        const premiumGate = await readOrganizationPremiumFeatureGate({
          database,
          env,
          organizationId: invitation.organizationId,
        });
        if (!premiumGate.allowed) {
          return c.json(premiumGate.body, premiumGate.status);
        }
      }

      const serializedBeforeAccept = serializeInvitation(invitation);
      if (!serializedBeforeAccept || serializedBeforeAccept.status !== 'pending') {
        return c.json({ message: 'Invitation is not pending.' }, 400);
      }

      const accepted = await acceptInvitationRecord({
        invitation,
        userId: identity.userId,
      });
      if (!accepted) {
        return c.json({ message: 'Invitation has already been processed.' }, 409);
      }

      const updatedInvitation = await hydrateInvitationRecord(invitationId);
      const serializedInvitation = serializeInvitation(updatedInvitation);
      if (!serializedInvitation) {
        return c.json({ message: 'Invitation could not be loaded after acceptance.' }, 400);
      }

      await writeInvitationEvent({
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        classroomId: invitation.classroomId,
        actorUserId: identity.userId,
        targetEmail: invitation.email,
        eventType: 'accepted',
        headers,
      });

      return c.json(
        {
          invitation: serializedInvitation,
          accepted,
        },
        200,
      );
    })();
  });

  authRoutes.openapi(rejectInvitationRoute, (c) => {
    return (async () => {
      const { invitationId } = c.req.valid('param');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }

      const invitation = await hydrateInvitationRecord(invitationId);
      if (!invitation) {
        return c.json({ message: 'Invitation not found.' }, 404);
      }
      if (!isInvitationRecipient({ invitation, email: identity.email })) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const serializedInvitation = serializeInvitation(invitation);
      if (!serializedInvitation || serializedInvitation.status !== 'pending') {
        return c.json({ message: 'Invitation is not pending.' }, 400);
      }

      await database
        .update(dbSchema.invitation)
        .set({
          status: 'rejected',
          respondedByUserId: identity.userId,
          respondedAt: new Date(),
        })
        .where(
          and(eq(dbSchema.invitation.id, invitation.id), eq(dbSchema.invitation.status, 'pending')),
        );

      const updatedInvitation = await hydrateInvitationRecord(invitation.id);
      const nextInvitation = serializeInvitation(updatedInvitation);
      if (!nextInvitation) {
        return c.json({ message: 'Invitation could not be loaded after rejection.' }, 400);
      }

      await writeInvitationEvent({
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        classroomId: invitation.classroomId,
        actorUserId: identity.userId,
        targetEmail: invitation.email,
        eventType: 'rejected',
        headers,
      });

      return c.json(nextInvitation, 200);
    })();
  });

  authRoutes.openapi(cancelInvitationRoute, (c) => {
    return (async () => {
      const { invitationId } = c.req.valid('param');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const invitation = await hydrateInvitationRecord(invitationId);
      if (!invitation) {
        return c.json({ message: 'Invitation not found.' }, 404);
      }

      const serializedInvitation = serializeInvitation(invitation);
      if (!serializedInvitation || serializedInvitation.status !== 'pending') {
        return c.json({ message: 'Invitation is not pending.' }, 400);
      }

      const authorized = await canCancelInvitation({
        invitation,
        userId: identity.userId,
      });
      if (!authorized) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      await database
        .update(dbSchema.invitation)
        .set({
          status: 'cancelled',
          respondedByUserId: identity.userId,
          respondedAt: new Date(),
        })
        .where(
          and(eq(dbSchema.invitation.id, invitation.id), eq(dbSchema.invitation.status, 'pending')),
        );

      const updatedInvitation = await hydrateInvitationRecord(invitation.id);
      const nextInvitation = serializeInvitation(updatedInvitation);
      if (!nextInvitation) {
        return c.json({ message: 'Invitation could not be loaded after cancellation.' }, 400);
      }

      await writeInvitationEvent({
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        classroomId: invitation.classroomId,
        actorUserId: identity.userId,
        targetEmail: invitation.email,
        eventType: 'cancelled',
        headers,
      });

      return c.json(nextInvitation, 200);
    })();
  });

  authRoutes.openapi(listParticipantsRoute, (c) => {
    return (async () => {
      const query = c.req.valid('query');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);

      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organizationId = resolveOrganizationId(
        query.organizationId,
        identity.activeOrganizationId,
      );
      if (!organizationId) {
        return c.json({ message: 'organizationId is required.' }, 400);
      }

      if (query.classroomId) {
        const classroomContext = await resolveClassroomContextByIds({
          organizationId,
          classroomId: query.classroomId,
        });
        if (!classroomContext) {
          return c.json({ message: 'Classroom not found.' }, 404);
        }

        const access = await resolveOrganizationClassroomAccess({
          database,
          userId: identity.userId,
          context: classroomContext,
        });
        if (!access.effective.canManageParticipants && !access.effective.canManageClassroom) {
          return c.json({ message: 'Forbidden' }, 403);
        }
      } else {
        const hasAccess = await hasOrganizationAdminAccess({
          organizationId,
          userId: identity.userId,
        });
        if (!hasAccess) {
          return c.json({ message: 'Forbidden' }, 403);
        }
      }

      const premiumGate = await readOrganizationPremiumFeatureGate({
        database,
        env,
        organizationId,
      });
      if (!premiumGate.allowed) {
        return c.json(premiumGate.body, premiumGate.status);
      }

      const filters = [eq(dbSchema.participant.organizationId, organizationId)];
      if (query.classroomId) {
        filters.push(eq(dbSchema.participant.classroomId, query.classroomId));
      }

      const rows = await database
        .select({
          id: dbSchema.participant.id,
          organizationId: dbSchema.participant.organizationId,
          classroomId: dbSchema.participant.classroomId,
          userId: dbSchema.participant.userId,
          email: dbSchema.participant.email,
          name: dbSchema.participant.name,
          createdAt: dbSchema.participant.createdAt,
          updatedAt: dbSchema.participant.updatedAt,
        })
        .from(dbSchema.participant)
        .where(and(...filters))
        .orderBy(desc(dbSchema.participant.createdAt));

      return c.json(
        rows.map((row: Record<string, unknown>) => ({
          ...row,
          createdAt: toIsoDateString(row.createdAt),
          updatedAt: toIsoDateString(row.updatedAt),
        })),
        200,
      );
    })();
  });

  authRoutes.openapi(selfEnrollParticipantRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }
      const participantEmail = identity.email;

      const publicOrganizationSlug = env.PUBLIC_EVENTS_ORG_SLUG?.trim();
      if (!publicOrganizationSlug) {
        return c.json({ message: 'PUBLIC_EVENTS_ORG_SLUG is not configured.' }, 503);
      }

      const publicOrganizationRows = await database
        .select({
          id: dbSchema.organization.id,
        })
        .from(dbSchema.organization)
        .where(eq(dbSchema.organization.slug, publicOrganizationSlug))
        .limit(1);
      const publicOrganization = publicOrganizationRows[0];
      if (!publicOrganization) {
        return c.json({ message: 'Public events organization was not found.' }, 503);
      }

      const publicClassroomSlug =
        env.PUBLIC_EVENTS_CLASSROOM_SLUG?.trim() || publicOrganizationSlug;
      if (publicClassroomSlug.length === 0) {
        return c.json({ message: 'PUBLIC_EVENTS_CLASSROOM_SLUG is invalid.' }, 503);
      }

      if (body.organizationId !== publicOrganization.id) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const classroomContext = body.classroomId
        ? await resolveClassroomContextByIds({
            organizationId: body.organizationId,
            classroomId: body.classroomId,
          })
        : await resolveClassroomContextBySlugs({
            orgSlug: publicOrganizationSlug,
            classroomSlug: publicClassroomSlug,
          });
      if (!classroomContext) {
        return c.json({ message: 'Public events classroom was not found.' }, 503);
      }

      const currentSession = await auth.api.getSession({ headers });
      const participantName = getStringValue(currentSession?.user?.name)?.trim();
      if (!participantName) {
        return c.json({ message: 'Current user name is unavailable.' }, 400);
      }

      const selectExistingParticipant = async () => {
        const rows = await database
          .select({
            id: dbSchema.participant.id,
            organizationId: dbSchema.participant.organizationId,
            classroomId: dbSchema.participant.classroomId,
            userId: dbSchema.participant.userId,
            email: dbSchema.participant.email,
            name: dbSchema.participant.name,
            createdAt: dbSchema.participant.createdAt,
            updatedAt: dbSchema.participant.updatedAt,
          })
          .from(dbSchema.participant)
          .where(
            and(
              eq(dbSchema.participant.organizationId, body.organizationId),
              eq(dbSchema.participant.classroomId, classroomContext.classroomId),
              or(
                eq(dbSchema.participant.userId, identity.userId),
                eq(dbSchema.participant.email, participantEmail),
              ),
            ),
          )
          .limit(1);

        return rows[0] ?? null;
      };

      const existingParticipant = await selectExistingParticipant();
      if (existingParticipant) {
        return c.json(
          {
            participant: serializeParticipant(existingParticipant),
            created: false,
          },
          200,
        );
      }

      const participantId = crypto.randomUUID();
      try {
        await database.insert(dbSchema.participant).values({
          id: participantId,
          organizationId: body.organizationId,
          classroomId: classroomContext.classroomId,
          userId: identity.userId,
          email: participantEmail,
          name: participantName,
        });
      } catch (error) {
        const maybeUniqueConstraint =
          error instanceof Error && error.message.includes('UNIQUE constraint failed');
        if (maybeUniqueConstraint) {
          const duplicated = await selectExistingParticipant();
          if (duplicated) {
            return c.json(
              {
                participant: serializeParticipant(duplicated),
                created: false,
              },
              200,
            );
          }
        }
        throw error;
      }

      const createdRows = await database
        .select({
          id: dbSchema.participant.id,
          organizationId: dbSchema.participant.organizationId,
          classroomId: dbSchema.participant.classroomId,
          userId: dbSchema.participant.userId,
          email: dbSchema.participant.email,
          name: dbSchema.participant.name,
          createdAt: dbSchema.participant.createdAt,
          updatedAt: dbSchema.participant.updatedAt,
        })
        .from(dbSchema.participant)
        .where(eq(dbSchema.participant.id, participantId))
        .limit(1);
      const createdParticipant = createdRows[0] ?? null;
      if (!createdParticipant) {
        return c.json({ message: 'Failed to create participant.' }, 500);
      }

      return c.json(
        {
          participant: serializeParticipant(createdParticipant),
          created: true,
        },
        200,
      );
    })();
  });

  registerBookingRoutes({
    authRoutes,
    auth,
    database,
    env,
    serviceImageUploadService,
  });

  const scopedOrganizationApiPrefixes = [
    '/participants',
    '/services',
    '/slots',
    '/recurring-schedules',
    '/bookings',
    '/ticket-types',
    '/ticket-packs',
    '/ticket-purchases',
  ] as const;

  authRoutes.on(['GET', 'POST'], '/orgs/:orgSlug/classrooms/:classroomSlug/*', async (c) => {
    const { orgSlug, classroomSlug } = c.req.param();
    const classroomContext = await resolveClassroomContextBySlugs({ orgSlug, classroomSlug });
    if (!classroomContext) {
      return c.json({ message: 'Organization or classroom not found.' }, 404);
    }

    const scopedPrefix = `/orgs/${orgSlug}/classrooms/${classroomSlug}`;
    const prefixIndex = c.req.path.indexOf(scopedPrefix);
    if (prefixIndex < 0) {
      return c.json({ message: 'Not found.' }, 404);
    }

    const suffix = c.req.path.slice(prefixIndex + scopedPrefix.length);
    if (
      suffix.length === 0 ||
      !scopedOrganizationApiPrefixes.some((candidatePrefix) => suffix.startsWith(candidatePrefix))
    ) {
      return c.json({ message: 'Not found.' }, 404);
    }

    const targetUrl = new URL(c.req.url);
    targetUrl.pathname = `/organizations${suffix}`;
    targetUrl.searchParams.set('organizationId', classroomContext.organizationId);
    targetUrl.searchParams.set('classroomId', classroomContext.classroomId);

    const headers = new Headers(c.req.raw.headers);
    headers.delete('content-length');

    let body: BodyInit | undefined;
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const contentType = c.req.raw.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const payload = await c.req.raw
          .clone()
          .json()
          .catch(() => ({}));
        const nextPayload =
          typeof payload === 'object' && payload !== null
            ? {
                ...payload,
                organizationId: classroomContext.organizationId,
                classroomId: classroomContext.classroomId,
              }
            : {
                organizationId: classroomContext.organizationId,
                classroomId: classroomContext.classroomId,
              };
        body = JSON.stringify(nextPayload);
        headers.set('content-type', 'application/json');
      } else {
        body = await c.req.raw.clone().arrayBuffer();
      }
    }

    const forwardedRequest = new Request(targetUrl.toString(), {
      method: c.req.method,
      headers,
      body,
    });

    const executionCtx = (() => {
      try {
        return c.executionCtx;
      } catch {
        return undefined;
      }
    })();

    return authRoutes.fetch(forwardedRequest, c.env, executionCtx);
  });

  return authRoutes;
};
