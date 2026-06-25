import { createRoute, z } from '@hono/zod-openapi';

/** 組織課金 summary 取得で、対象 organization を明示する query schema。 */
export const organizationBillingQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

/** Premium Checkout を開始する organization と請求間隔を受け取る body schema。 */
export const organizationBillingCheckoutBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  billingInterval: z.enum(['month', 'year']),
});

/** Stripe Customer Portal handoff を開始する organization を受け取る body schema。 */
export const organizationBillingPortalBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

/** Premium trial を開始する organization を受け取る body schema。 */
export const organizationBillingTrialBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

/** Trial 中の支払い方法登録 handoff を開始する organization を受け取る body schema。 */
export const organizationBillingPaymentMethodBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

/** Trial 終了時の Premium lifecycle 判定を実行する organization を受け取る body schema。 */
export const organizationBillingTrialCompletionBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

/** 内部 billing inspection の対象 organization を path parameter から検証する schema。 */
export const internalBillingInspectionParamsSchema = z.object({
  organizationId: z.string().min(1),
});

/** Stripe price と既知 tier catalog から解決した有料 tier の API schema。 */
export const organizationBillingPaidTierSchema = z.object({
  code: z.enum(['premium_default', 'premium_growth', 'premium_scale', 'premium_unknown']),
  label: z.string().min(1),
  resolution: z.enum(['not_paid', 'legacy_default', 'known_price', 'unknown_price']),
  capabilities: z.array(
    z.enum(['organization_premium_features', 'advanced_billing_communications']),
  ),
  diagnosticReason: z.string().nullable(),
});

/** Owner が現在実行できる課金 action と、実行できない理由を返す schema。 */
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

/** Checkout や entitlement を遮断しない billing profile readiness の表示 schema。 */
export const organizationBillingProfileReadinessSchema = z.object({
  state: z.enum(['complete', 'incomplete', 'unavailable', 'not_required']),
  nextAction: z.string().nullable(),
  checkedAt: z.string().nullable(),
  gatesCheckout: z.literal(false),
  gatesPremiumEligibility: z.literal(false),
});

/** 共有 Billing API への shadow read 結果を、既存判定に影響させず診断用に返す schema。 */
export const organizationBillingApiShadowSchema = z.object({
  status: z.enum(['disabled', 'matched', 'mismatch', 'unavailable']),
  checkedAt: z.string(),
  disabledReason: z.enum(['disabled_by_flag', 'missing_base_url', 'missing_api_key']).nullable(),
  unavailableReason: z.string().nullable(),
  priceResolution: z.enum(['not_applicable', 'known', 'unknown']).nullable(),
  planCode: z.string().nullable(),
  subscriptionStatus: z
    .enum(['free', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete'])
    .nullable(),
  features: z.record(z.string(), z.unknown()).nullable(),
  legacy: z.object({
    planCode: z.enum(['free', 'premium']),
    subscriptionStatus: z.enum([
      'free',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
    ]),
    entitlementState: z.enum(['free_only', 'premium_enabled']),
    premiumEligible: z.boolean(),
    capabilities: z.array(
      z.enum(['organization_premium_features', 'advanced_billing_communications']),
    ),
  }),
  differences: z.array(
    z.object({
      field: z.string().min(1),
      legacy: z.unknown(),
      billingApi: z.unknown(),
      reason: z.string().min(1),
    }),
  ),
});

/** Invoice/payment webhook 由来の owner 向け payment event を返す schema。 */
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

/** UI と inspection が共有する支払い問題 state の schema。 */
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

/** 支払い問題の開始時刻、根拠、猶予期限を返す schema。 */
export const organizationBillingPaymentIssueTimingSchema = z.object({
  issueStartedAt: z.string().nullable(),
  issueStartedAtSource: z.enum(['provider_issue_time', 'application_receipt_time', 'none']),
  graceEndsAt: z.string().nullable(),
});

/** Owner UI が表示する現在の organization billing summary の response schema。 */
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
  billingApiShadow: organizationBillingApiShadowSchema.nullable(),
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
      aggregateRoot: z.literal('billing_account'),
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

/** Stripe など外部 provider へ遷移する handoff URL と再利用状態の schema。 */
export const organizationBillingHandoffSchema = z.object({
  provider: z.literal('stripe'),
  purpose: z.enum(['trial_start', 'paid_checkout', 'payment_method_setup', 'billing_portal']),
  url: z.string().url(),
  expiresAt: z.string(),
  reused: z.boolean(),
  operationAttemptId: z.string().min(1).optional(),
});

/** 課金 action 実行結果、更新後 summary、外部 handoff 情報を返す schema。 */
export const organizationBillingActionResponseSchema = z.object({
  status: z.enum(['succeeded', 'processing', 'conflict', 'failed']),
  message: z.string().nullable(),
  billing: organizationBillingSummarySchema.nullable(),
  handoff: organizationBillingHandoffSchema.nullable(),
  url: z.string().url().nullable().optional(),
});

/** 課金 action が domain response または単純 message を返す場合の union schema。 */
export const organizationBillingActionOrMessageResponseSchema = z.union([
  organizationBillingActionResponseSchema,
  z.object({ message: z.string().min(1) }),
]);

/** Internal inspection で lifecycle と entitlement の現在値を要約する schema。 */
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

/** Internal inspection で Stripe 側に紐づく provider state を返す schema。 */
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

/** Billing aggregate の append-only lifecycle event を inspection 用に返す schema。 */
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

/** Billing reconciliation や通知などの support signal を inspection 用に返す schema。 */
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

/** Stripe 側と application aggregate 側の現在値を並べて比較する schema。 */
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

/** Reconciliation mismatch や解決状態を時系列で確認する signal schema。 */
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

/** Reconciliation 判断に使う Stripe webhook 受領履歴の inspection schema。 */
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

/** 署名・payload・処理 stage ごとの webhook failure を返す inspection schema。 */
export const internalBillingInspectionReconciliationWebhookFailureSchema = z.object({
  eventId: z.string().min(1).nullable(),
  eventType: z.string().min(1).nullable(),
  failureStage: z.string().min(1),
  failureReason: z.string().min(1),
  createdAt: z.string().nullable(),
});

/** Stripe と application state の整合性、signal、webhook 履歴をまとめる schema。 */
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

/** Trial reminder や支払い問題通知の個別配送履歴を返す schema。 */
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

/** Trial reminder の期待状態と実配送履歴を検査する schema。 */
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

/** Internal inspection の通知セクション全体を表す schema。 */
export const internalBillingInspectionNotificationsSchema = z.object({
  reminderDelivery: internalBillingInspectionReminderDeliverySchema,
});

/** 支払い問題通知の宛先ごとの配送状態と retry 可否を返す schema。 */
export const internalPaymentIssueNotificationRecipientSchema = z.object({
  recipientUserId: z.string().min(1).nullable(),
  recipientEmail: z.string().min(1).nullable(),
  deliveryState: z.enum(['requested', 'retried', 'sent', 'failed', 'skipped']),
  retryEligible: z.boolean(),
  failureReason: z.string().min(1).nullable(),
});

/** 支払い問題に関連して support が確認すべき signal を返す schema。 */
export const internalPaymentIssueSupportSignalSchema = z.object({
  reason: z.string().min(1),
  status: z.string().min(1),
});

/** 支払い失敗・認証要求・猶予期限に関する internal inspection schema。 */
export const internalPaymentIssueInspectionSchema = z.object({
  paymentIssueState: organizationBillingPaymentIssueStateSchema,
  notificationRecipients: z.array(internalPaymentIssueNotificationRecipientSchema),
  staleFailureEvents: z.array(organizationBillingInvoicePaymentEventSchema),
  supportSignals: z.array(internalPaymentIssueSupportSignalSchema),
});

/** Owner へ直接 URL を保存せず provider reference として扱う payment document schema。 */
export const internalBillingInspectionPaymentDocumentsSchema = z.object({
  aggregateRoot: z.literal('billing_account'),
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

/** Stripe Checkout/Portal など外部 handoff operation の試行履歴 schema。 */
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

/** Billing state、通知、reconciliation、webhook を同じ時系列で見る timeline schema。 */
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

/** Internal inspection の timeline entries を返す schema。 */
export const internalBillingInspectionTimelineSchema = z.object({
  entries: z.array(internalBillingInspectionTimelineEntrySchema),
});

/** Internal operator 向けの読み取り専用 billing inspection response schema。 */
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

/** Owner が organization billing summary を取得する OpenAPI route 定義。 */
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

/** Owner が Premium subscription 用 Checkout handoff を Billing API 経由で作成する OpenAPI route 定義。 */
export const createOrganizationBillingCheckoutRoute = createRoute({
  method: 'post',
  path: '/organizations/billing/checkout',
  tags: ['Organization Billing'],
  summary: 'Create Billing API Checkout URL for premium subscription',
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
      description: 'Billing API Checkout URL',
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
      description: 'Billing API action is not configured',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
    500: {
      description: 'Stripe checkout creation failed',
      content: { 'application/json': { schema: organizationBillingActionOrMessageResponseSchema } },
    },
  },
});

/** Owner が Stripe Customer Portal handoff を作成する OpenAPI route 定義。 */
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

/** Owner が Premium trial を開始する OpenAPI route 定義。 */
export const createOrganizationBillingTrialRoute = createRoute({
  method: 'post',
  path: '/organizations/billing/trial',
  tags: ['Organization Billing'],
  summary: 'Request Billing API to start a 7-day premium trial for the active organization',
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

/** Owner が trial 中の支払い方法登録 handoff を開始する OpenAPI route 定義。 */
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

/** Owner が trial 終了時の Premium lifecycle 判定を実行する OpenAPI route 定義。 */
export const createOrganizationBillingTrialCompletionRoute = createRoute({
  method: 'post',
  path: '/organizations/billing/trial/complete',
  tags: ['Organization Billing'],
  summary: 'Request Billing API to complete premium trial lifecycle rules',
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

/** Internal operator が organization billing の検査 view を取得する OpenAPI route 定義。 */
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

/** Organization billing summary 取得 query の型。 */
export type OrganizationBillingQuery = z.infer<typeof organizationBillingQuerySchema>;

/** Premium Checkout 作成 body の型。 */
export type OrganizationBillingCheckoutBody = z.infer<typeof organizationBillingCheckoutBodySchema>;

/** Customer Portal 作成 body の型。 */
export type OrganizationBillingPortalBody = z.infer<typeof organizationBillingPortalBodySchema>;

/** Premium trial 開始 body の型。 */
export type OrganizationBillingTrialBody = z.infer<typeof organizationBillingTrialBodySchema>;

/** 支払い方法登録 handoff 作成 body の型。 */
export type OrganizationBillingPaymentMethodBody = z.infer<
  typeof organizationBillingPaymentMethodBodySchema
>;

/** Trial completion 評価 body の型。 */
export type OrganizationBillingTrialCompletionBody = z.infer<
  typeof organizationBillingTrialCompletionBodySchema
>;

/** Internal billing inspection path params の型。 */
export type InternalBillingInspectionParams = z.infer<typeof internalBillingInspectionParamsSchema>;
