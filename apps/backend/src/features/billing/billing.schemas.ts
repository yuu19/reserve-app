import { createRoute, z } from '@hono/zod-openapi';

export const organizationBillingQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

export const organizationBillingCheckoutBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  billingInterval: z.enum(['month', 'year']),
});

export const organizationBillingPortalBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

export const organizationBillingTrialBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

export const organizationBillingPaymentMethodBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

export const organizationBillingTrialCompletionBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

export const internalBillingInspectionParamsSchema = z.object({
  organizationId: z.string().min(1),
});

export const organizationBillingPaidTierSchema = z.object({
  code: z.enum(['premium_default', 'premium_growth', 'premium_scale', 'premium_unknown']),
  label: z.string().min(1),
  resolution: z.enum(['not_paid', 'legacy_default', 'known_price', 'unknown_price']),
  capabilities: z.array(
    z.enum(['organization_premium_features', 'advanced_billing_communications']),
  ),
  diagnosticReason: z.string().nullable(),
});

export const organizationBillingActionAvailabilitySchema = z.object({
  canStartTrial: z.boolean(),
  canStartPaidCheckout: z.boolean(),
  canRegisterPaymentMethod: z.boolean(),
  canOpenBillingPortal: z.boolean(),
  trialUsed: z.boolean(),
  availableIntervals: z.array(z.enum(['month', 'year'])),
  nextOwnerAction: z.string().nullable(),
  readOnlyReason: z.string().nullable(),
});

export const organizationBillingProfileReadinessSchema = z.object({
  state: z.enum(['complete', 'incomplete', 'unavailable', 'not_required']),
  nextAction: z.string().nullable(),
  checkedAt: z.string().nullable(),
  gatesCheckout: z.literal(false),
  gatesPremiumEligibility: z.literal(false),
});

export const organizationBillingInvoicePaymentEventSchema = z.object({
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

export const organizationBillingPaymentIssueStateSchema = z.enum([
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

export const organizationBillingPaymentIssueTimingSchema = z.object({
  issueStartedAt: z.string().nullable(),
  issueStartedAtSource: z.enum(['provider_issue_time', 'application_receipt_time', 'none']),
  graceEndsAt: z.string().nullable(),
});

export const organizationBillingSummarySchema = z.object({
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

export const organizationBillingHandoffSchema = z.object({
  provider: z.literal('stripe'),
  purpose: z.enum(['trial_start', 'paid_checkout', 'payment_method_setup', 'billing_portal']),
  url: z.string().url(),
  expiresAt: z.string(),
  reused: z.boolean(),
  operationAttemptId: z.string().min(1).optional(),
});

export const organizationBillingActionResponseSchema = z.object({
  status: z.enum(['succeeded', 'processing', 'conflict', 'failed']),
  message: z.string().nullable(),
  billing: organizationBillingSummarySchema.nullable(),
  handoff: organizationBillingHandoffSchema.nullable(),
  url: z.string().url().nullable().optional(),
});
export const organizationBillingActionOrMessageResponseSchema = z.union([
  organizationBillingActionResponseSchema,
  z.object({ message: z.string().min(1) }),
]);

export const internalBillingInspectionSummarySchema = z.object({
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

export const internalBillingInspectionProviderSchema = z.object({
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

export const internalBillingInspectionLifecycleEventSchema = z.object({
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

export const internalBillingInspectionSignalSchema = z.object({
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

export const internalBillingInspectionReconciliationCurrentComparisonSchema = z.object({
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

export const internalBillingInspectionReconciliationSignalSchema = z.object({
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

export const internalBillingInspectionReconciliationWebhookEventSchema = z.object({
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

export const internalBillingInspectionReconciliationWebhookFailureSchema = z.object({
  eventId: z.string().min(1).nullable(),
  eventType: z.string().min(1).nullable(),
  failureStage: z.string().min(1),
  failureReason: z.string().min(1),
  createdAt: z.string().nullable(),
});

export const internalBillingInspectionReconciliationSchema = z.object({
  status: z.enum(['not_applicable', 'aligned', 'mismatch', 'pending', 'unavailable', 'incomplete']),
  comparable: z.boolean(),
  latestSignalStatus: z.enum(['pending', 'mismatch', 'unavailable', 'resolved']).nullable(),
  latestSignalReason: z.string().min(1).nullable(),
  currentComparison: internalBillingInspectionReconciliationCurrentComparisonSchema,
  recentSignals: z.array(internalBillingInspectionReconciliationSignalSchema),
  recentWebhookEvents: z.array(internalBillingInspectionReconciliationWebhookEventSchema),
  recentWebhookFailures: z.array(internalBillingInspectionReconciliationWebhookFailureSchema),
});

export const internalBillingInspectionNotificationHistoryEntrySchema = z.object({
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

export const internalBillingInspectionReminderDeliverySchema = z.object({
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

export const internalBillingInspectionNotificationsSchema = z.object({
  reminderDelivery: internalBillingInspectionReminderDeliverySchema,
});

export const internalPaymentIssueNotificationRecipientSchema = z.object({
  recipientUserId: z.string().min(1).nullable(),
  recipientEmail: z.string().min(1).nullable(),
  deliveryState: z.enum(['requested', 'retried', 'sent', 'failed', 'skipped']),
  retryEligible: z.boolean(),
  failureReason: z.string().min(1).nullable(),
});

export const internalPaymentIssueSupportSignalSchema = z.object({
  reason: z.string().min(1),
  status: z.string().min(1),
});

export const internalPaymentIssueInspectionSchema = z.object({
  paymentIssueState: organizationBillingPaymentIssueStateSchema,
  notificationRecipients: z.array(internalPaymentIssueNotificationRecipientSchema),
  staleFailureEvents: z.array(organizationBillingInvoicePaymentEventSchema),
  supportSignals: z.array(internalPaymentIssueSupportSignalSchema),
});

export const internalBillingInspectionPaymentDocumentsSchema = z.object({
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

export const internalBillingInspectionOperationAttemptSchema = z.object({
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

export const internalBillingInspectionTimelineEntrySchema = z.object({
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

export const internalBillingInspectionTimelineSchema = z.object({
  entries: z.array(internalBillingInspectionTimelineEntrySchema),
});

export const internalBillingInspectionResponseSchema = z.object({
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

export const getOrganizationBillingRoute = createRoute({
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

export const createOrganizationBillingCheckoutRoute = createRoute({
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

export const createOrganizationBillingPortalRoute = createRoute({
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

export const createOrganizationBillingTrialRoute = createRoute({
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

export const createOrganizationBillingPaymentMethodRoute = createRoute({
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

export const createOrganizationBillingTrialCompletionRoute = createRoute({
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

export const getInternalBillingInspectionRoute = createRoute({
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

export type OrganizationBillingQuery = z.infer<typeof organizationBillingQuerySchema>;
export type OrganizationBillingCheckoutBody = z.infer<typeof organizationBillingCheckoutBodySchema>;
export type OrganizationBillingPortalBody = z.infer<typeof organizationBillingPortalBodySchema>;
export type OrganizationBillingTrialBody = z.infer<typeof organizationBillingTrialBodySchema>;
export type OrganizationBillingPaymentMethodBody = z.infer<
  typeof organizationBillingPaymentMethodBodySchema
>;
export type OrganizationBillingTrialCompletionBody = z.infer<
  typeof organizationBillingTrialCompletionBodySchema
>;
export type InternalBillingInspectionParams = z.infer<typeof internalBillingInspectionParamsSchema>;
