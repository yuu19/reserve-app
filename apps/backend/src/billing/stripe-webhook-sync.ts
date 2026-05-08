import { and, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import {
  applyOrganizationPremiumTrialCompletion,
  resolveBillingIntervalFromPriceId,
  selectOrganizationBillingSummary,
  selectOrganizationBillingByStripeIdentifiers,
  updateOrganizationBillingStripeCustomerId,
  upsertOrganizationBillingByOrganizationId,
  type OrganizationBillingSubscriptionStatus,
} from './organization-billing.js';
import {
  normalizeStripeChargeReceiptDocument,
  normalizeStripeInvoiceDocument,
} from './organization-billing-documents.js';
import {
  appendOrganizationBillingInvoicePaymentEvent,
  type OrganizationBillingInvoicePaymentEventType,
  type OrganizationBillingInvoicePaymentOwnerFacingStatus,
} from './organization-billing-invoice-events.js';
import {
  appendOrganizationBillingAuditEvent,
  appendOrganizationBillingSignal,
  appendResolvedBillingSignalIfNeeded,
  evaluateReconciliationMismatchReason,
  readOrganizationBillingObservationSnapshot,
} from './organization-billing-observability.js';
import {
  sendOrganizationPaymentIssueNotification,
  sendOrganizationTrialWillEndReminder,
} from './organization-billing-notifications.js';
import {
  readStripeBillingCheckoutMetadata,
  readStripeCheckoutSessionSummary,
  readStripeInvoicePaymentEventSummary,
  readStripePaymentMethodCheckoutMetadata,
  readStripeSetupCheckoutSessionSummaryById,
  readStripeSubscriptionSummary,
  readStripeSubscriptionSummaryById,
  updateCustomerDefaultPaymentMethod,
  updateSubscriptionDefaultPaymentMethod,
  type StripeSubscriptionSummary,
  type StripeWebhookEvent,
  type StripeWebhookSignatureVerificationStatus,
} from '../payment/stripe.js';

const ORGANIZATION_BILLING_WEBHOOK_SCOPE = 'organization_billing';

type StripeWebhookFailureStage =
  | 'signature_verification'
  | 'payload_parse'
  | 'event_normalization'
  | 'organization_linkage'
  | 'provider_reconciliation'
  | 'event_processing';

type StripeWebhookFailureReason =
  | 'invalid_signature'
  | 'signature_missing'
  | 'signature_expired'
  | 'signature_mismatched'
  | 'invalid_payload'
  | 'invalid_checkout_session_payload'
  | 'invalid_subscription_payload'
  | 'invalid_invoice_payload'
  | 'unsupported_subscription_status'
  | 'organization_billing_not_found'
  | 'latest_subscription_lookup_failed'
  | 'setup_payment_method_missing'
  | 'setup_customer_missing'
  | 'setup_session_lookup_failed'
  | 'trial_completion_pending'
  | 'trial_completion_not_ready'
  | 'trial_reminder_owner_not_found'
  | 'trial_reminder_config_missing'
  | 'trial_reminder_delivery_failed'
  | 'payment_issue_notification_delivery_failed'
  | 'unexpected_processing_error';

type NormalizedStripeOrganizationBillingWebhookEvent =
  | {
      kind: 'checkout_completed';
      eventId: string;
      eventType: string;
      organizationId: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      stripePriceId: string | null;
      billingInterval: 'month' | 'year';
    }
  | {
      kind: 'payment_method_setup_completed';
      eventId: string;
      eventType: string;
      sessionId: string;
      organizationId: string;
      stripeCustomerId: string | null;
      setupIntentPaymentMethodId: string | null;
    }
  | {
      kind: 'subscription_lifecycle';
      eventId: string;
      eventType: string;
      occurredAt: Date | null;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string;
      subscription: StripeSubscriptionSummary;
    }
  | {
      kind: 'trial_will_end';
      eventId: string;
      eventType: string;
      occurredAt: Date | null;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string;
      subscription: StripeSubscriptionSummary;
    }
  | {
      kind: 'invoice_payment_event';
      eventId: string;
      eventType: string;
      invoiceEventType: OrganizationBillingInvoicePaymentEventType;
      ownerFacingStatus: OrganizationBillingInvoicePaymentOwnerFacingStatus;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      stripeInvoiceId: string | null;
      stripePaymentIntentId: string | null;
      providerStatus: string | null;
      occurredAt: Date | null;
      invoicePayload: Record<string, unknown>;
      latestChargePayload: Record<string, unknown> | null;
    }
  | {
      kind: 'failure';
      eventId: string;
      eventType: string;
      failureStage: Exclude<StripeWebhookFailureStage, 'signature_verification' | 'payload_parse'>;
      failureReason: Exclude<
        StripeWebhookFailureReason,
        'invalid_signature' | 'invalid_payload' | 'organization_billing_not_found'
      >;
      stripeCustomerId?: string | null;
      stripeSubscriptionId?: string | null;
    }
  | {
      kind: 'not_billing';
    };

const recordStripeWebhookFailure = async ({
  database,
  eventId,
  eventType,
  failureStage,
  failureReason,
  organizationId,
  stripeCustomerId,
  stripeSubscriptionId,
}: {
  database: AuthRuntimeDatabase;
  eventId?: string | null;
  eventType?: string | null;
  failureStage: StripeWebhookFailureStage;
  failureReason: StripeWebhookFailureReason;
  organizationId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}) => {
  await database.insert(dbSchema.stripeWebhookFailure).values({
    id: crypto.randomUUID(),
    eventId: eventId ?? null,
    eventType: eventType ?? null,
    scope: ORGANIZATION_BILLING_WEBHOOK_SCOPE,
    failureStage,
    failureReason,
    organizationId: organizationId ?? null,
    stripeCustomerId: stripeCustomerId ?? null,
    stripeSubscriptionId: stripeSubscriptionId ?? null,
  });
};

const claimStripeWebhookEvent = async ({
  database,
  eventId,
  eventType,
}: {
  database: AuthRuntimeDatabase;
  eventId: string;
  eventType: string;
}) => {
  const rows = await database
    .insert(dbSchema.stripeWebhookEvent)
    .values({
      id: eventId,
      eventType,
      scope: ORGANIZATION_BILLING_WEBHOOK_SCOPE,
      processingStatus: 'processing',
    })
    .onConflictDoNothing()
    .returning({
      id: dbSchema.stripeWebhookEvent.id,
    });

  if (rows[0]) {
    return true;
  }

  const retryRows = await database
    .update(dbSchema.stripeWebhookEvent)
    .set({
      processingStatus: 'processing',
      failureReason: null,
      processedAt: null,
    })
    .where(
      and(
        eq(dbSchema.stripeWebhookEvent.id, eventId),
        eq(dbSchema.stripeWebhookEvent.scope, ORGANIZATION_BILLING_WEBHOOK_SCOPE),
        eq(dbSchema.stripeWebhookEvent.processingStatus, 'failed'),
      ),
    )
    .returning({
      id: dbSchema.stripeWebhookEvent.id,
    });

  if (retryRows[0]) {
    return true;
  }

  await database
    .update(dbSchema.stripeWebhookEvent)
    .set({
      duplicateDetected: true,
      duplicateDetectedAt: new Date(),
      receiptStatus: 'duplicate',
    })
    .where(
      and(
        eq(dbSchema.stripeWebhookEvent.id, eventId),
        eq(dbSchema.stripeWebhookEvent.scope, ORGANIZATION_BILLING_WEBHOOK_SCOPE),
      ),
    );

  return false;
};

const markStripeWebhookEventProcessed = async ({
  database,
  eventId,
  organizationId,
  stripeCustomerId,
  stripeSubscriptionId,
}: {
  database: AuthRuntimeDatabase;
  eventId: string;
  organizationId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}) => {
  await database
    .update(dbSchema.stripeWebhookEvent)
    .set({
      processingStatus: 'processed',
      organizationId: organizationId ?? null,
      stripeCustomerId: stripeCustomerId ?? null,
      stripeSubscriptionId: stripeSubscriptionId ?? null,
      failureReason: null,
      processedAt: new Date(),
    })
    .where(eq(dbSchema.stripeWebhookEvent.id, eventId));
};

const markStripeWebhookEventFailed = async ({
  database,
  eventId,
  organizationId,
  stripeCustomerId,
  stripeSubscriptionId,
  failureReason,
}: {
  database: AuthRuntimeDatabase;
  eventId: string;
  organizationId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  failureReason: StripeWebhookFailureReason;
}) => {
  await database
    .update(dbSchema.stripeWebhookEvent)
    .set({
      processingStatus: 'failed',
      organizationId: organizationId ?? null,
      stripeCustomerId: stripeCustomerId ?? null,
      stripeSubscriptionId: stripeSubscriptionId ?? null,
      failureReason,
      processedAt: null,
    })
    .where(eq(dbSchema.stripeWebhookEvent.id, eventId));
};

type StripeOrganizationBillingWebhookResult =
  | {
      matched: false;
    }
  | {
      matched: true;
      duplicate: boolean;
      statusCode?: 200 | 500;
      message?: string;
    };

const createStripeWebhookHandledResult = ({
  duplicate,
  retryable = false,
  message,
}: {
  duplicate: boolean;
  retryable?: boolean;
  message?: string;
}): StripeOrganizationBillingWebhookResult => ({
  matched: true,
  duplicate,
  statusCode: retryable ? 500 : 200,
  message,
});

const failStripeWebhookEvent = async ({
  database,
  eventId,
  eventType,
  failureStage,
  failureReason,
  organizationId,
  stripeCustomerId,
  stripeSubscriptionId,
  retryable = false,
  message,
}: {
  database: AuthRuntimeDatabase;
  eventId: string;
  eventType: string;
  failureStage: StripeWebhookFailureStage;
  failureReason: StripeWebhookFailureReason;
  organizationId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  retryable?: boolean;
  message?: string;
}): Promise<StripeOrganizationBillingWebhookResult> => {
  await recordStripeWebhookFailure({
    database,
    eventId,
    eventType,
    failureStage,
    failureReason,
    organizationId,
    stripeCustomerId,
    stripeSubscriptionId,
  });
  await markStripeWebhookEventFailed({
    database,
    eventId,
    organizationId,
    stripeCustomerId,
    stripeSubscriptionId,
    failureReason,
  });
  return createStripeWebhookHandledResult({
    duplicate: false,
    retryable,
    message,
  });
};

const normalizeSubscriptionStatus = (
  value: string | null,
): OrganizationBillingSubscriptionStatus | null => {
  switch (value) {
    case 'free':
    case 'trialing':
    case 'active':
    case 'past_due':
    case 'canceled':
    case 'unpaid':
    case 'incomplete':
      return value;
    default:
      return null;
  }
};

const resolveInvoicePaymentEventMapping = (
  eventType: string,
): {
  eventType: OrganizationBillingInvoicePaymentEventType;
  ownerFacingStatus: OrganizationBillingInvoicePaymentOwnerFacingStatus;
} | null => {
  switch (eventType) {
    case 'invoice.finalized':
    case 'invoice.paid':
      return {
        eventType: 'invoice_available',
        ownerFacingStatus: 'available',
      };
    case 'invoice.payment_succeeded':
      return {
        eventType: 'payment_succeeded',
        ownerFacingStatus: 'succeeded',
      };
    case 'invoice.payment_failed':
      return {
        eventType: 'payment_failed',
        ownerFacingStatus: 'failed',
      };
    case 'invoice.payment_action_required':
      return {
        eventType: 'payment_action_required',
        ownerFacingStatus: 'action_required',
      };
    default:
      return null;
  }
};

const readStripeEventCreatedAt = (event: StripeWebhookEvent): Date | null => {
  const rawCreated = event.created;
  const unixSeconds =
    typeof rawCreated === 'number'
      ? rawCreated
      : typeof rawCreated === 'string' && rawCreated.trim().length > 0
        ? Number(rawCreated)
        : null;

  if (unixSeconds === null || !Number.isFinite(unixSeconds)) {
    return null;
  }

  const createdAt = new Date(unixSeconds * 1000);
  return Number.isNaN(createdAt.getTime()) ? null : createdAt;
};

const normalizeStripeOrganizationBillingWebhookEvent = ({
  event,
  env,
}: {
  event: StripeWebhookEvent;
  env: AuthRuntimeEnv;
}): NormalizedStripeOrganizationBillingWebhookEvent => {
  if (event.type === 'checkout.session.completed') {
    const session = readStripeCheckoutSessionSummary(event.data?.object ?? null);
    if (!session) {
      return {
        kind: 'failure',
        eventId: event.id,
        eventType: event.type,
        failureStage: 'event_normalization',
        failureReason: 'invalid_checkout_session_payload',
      };
    }

    const billingMetadata = readStripeBillingCheckoutMetadata(session.metadata);
    if (billingMetadata) {
      return {
        kind: 'checkout_completed',
        eventId: event.id,
        eventType: event.type,
        organizationId: billingMetadata.organizationId,
        stripeCustomerId: session.customerId,
        stripeSubscriptionId: session.subscriptionId,
        stripePriceId:
          billingMetadata.billingInterval === 'month'
            ? (env.STRIPE_PREMIUM_MONTHLY_PRICE_ID?.trim() ?? null)
            : (env.STRIPE_PREMIUM_YEARLY_PRICE_ID?.trim() ?? null),
        billingInterval: billingMetadata.billingInterval,
      };
    }

    const paymentMethodMetadata = readStripePaymentMethodCheckoutMetadata(session.metadata);
    if (paymentMethodMetadata) {
      return {
        kind: 'payment_method_setup_completed',
        eventId: event.id,
        eventType: event.type,
        sessionId: session.id,
        organizationId: paymentMethodMetadata.organizationId,
        stripeCustomerId: session.customerId,
        setupIntentPaymentMethodId: session.setupIntentPaymentMethodId,
      };
    }

    return { kind: 'not_billing' };
  }

  const invoicePaymentMapping = resolveInvoicePaymentEventMapping(event.type);
  if (invoicePaymentMapping) {
    const invoiceSummary = readStripeInvoicePaymentEventSummary(event.data?.object ?? null);
    const invoicePayload =
      typeof event.data?.object === 'object' && event.data.object !== null
        ? event.data.object
        : null;
    if (!invoiceSummary || !invoicePayload) {
      return {
        kind: 'failure',
        eventId: event.id,
        eventType: event.type,
        failureStage: 'event_normalization',
        failureReason: 'invalid_invoice_payload',
      };
    }

    return {
      kind: 'invoice_payment_event',
      eventId: event.id,
      eventType: event.type,
      invoiceEventType: invoicePaymentMapping.eventType,
      ownerFacingStatus: invoicePaymentMapping.ownerFacingStatus,
      stripeCustomerId: invoiceSummary.customerId,
      stripeSubscriptionId: invoiceSummary.subscriptionId,
      stripeInvoiceId: invoiceSummary.invoiceId,
      stripePaymentIntentId: invoiceSummary.paymentIntentId,
      providerStatus: invoiceSummary.providerStatus,
      occurredAt: invoiceSummary.createdAt,
      invoicePayload,
      latestChargePayload: invoiceSummary.latestCharge,
    };
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted' ||
    event.type === 'customer.subscription.trial_will_end'
  ) {
    const subscription = readStripeSubscriptionSummary(event.data?.object ?? null);
    if (!subscription) {
      return {
        kind: 'failure',
        eventId: event.id,
        eventType: event.type,
        failureStage: 'event_normalization',
        failureReason: 'invalid_subscription_payload',
      };
    }

    return event.type === 'customer.subscription.trial_will_end'
      ? {
          kind: 'trial_will_end',
          eventId: event.id,
          eventType: event.type,
          occurredAt: readStripeEventCreatedAt(event),
          stripeCustomerId: subscription.customerId,
          stripeSubscriptionId: subscription.id,
          subscription,
        }
      : {
          kind: 'subscription_lifecycle',
          eventId: event.id,
          eventType: event.type,
          occurredAt: readStripeEventCreatedAt(event),
          stripeCustomerId: subscription.customerId,
          stripeSubscriptionId: subscription.id,
          subscription,
        };
  }

  return { kind: 'not_billing' };
};

const resolveLatestSubscriptionSummary = async ({
  env,
  eventType,
  fallback,
}: {
  env: AuthRuntimeEnv;
  eventType: string;
  fallback: StripeSubscriptionSummary;
}) => {
  try {
    return await readStripeSubscriptionSummaryById({
      env,
      subscriptionId: fallback.id,
    });
  } catch {
    if (eventType === 'customer.subscription.deleted' && fallback.status === 'canceled') {
      return fallback;
    }
    return null;
  }
};

const resolveLatestSubscriptionSummaryForInvoiceEvent = async ({
  env,
  stripeSubscriptionId,
}: {
  env: AuthRuntimeEnv;
  stripeSubscriptionId?: string | null;
}) => {
  if (!env.STRIPE_SECRET_KEY?.trim() || !stripeSubscriptionId) {
    return null;
  }

  try {
    return await readStripeSubscriptionSummaryById({
      env,
      subscriptionId: stripeSubscriptionId,
    });
  } catch {
    return null;
  }
};

const isProviderRecoveredSubscriptionStatus = (
  subscriptionStatus: OrganizationBillingSubscriptionStatus,
) => {
  return (
    subscriptionStatus === 'active' ||
    subscriptionStatus === 'trialing' ||
    subscriptionStatus === 'canceled' ||
    subscriptionStatus === 'free'
  );
};

export const handleStripeOrganizationBillingWebhook = async ({
  database,
  env,
  event,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  event: StripeWebhookEvent;
}): Promise<StripeOrganizationBillingWebhookResult> => {
  const normalized = normalizeStripeOrganizationBillingWebhookEvent({
    event,
    env,
  });
  if (normalized.kind === 'not_billing') {
    return { matched: false };
  }

  if (normalized.kind === 'failure') {
    const claimed = await claimStripeWebhookEvent({
      database,
      eventId: normalized.eventId,
      eventType: normalized.eventType,
    });
    if (!claimed) {
      return createStripeWebhookHandledResult({ duplicate: true });
    }

    return failStripeWebhookEvent({
      database,
      eventId: normalized.eventId,
      eventType: normalized.eventType,
      failureStage: normalized.failureStage,
      failureReason: normalized.failureReason,
      stripeCustomerId: normalized.stripeCustomerId ?? null,
      stripeSubscriptionId: normalized.stripeSubscriptionId ?? null,
    });
  }

  const claimed = await claimStripeWebhookEvent({
    database,
    eventId: normalized.eventId,
    eventType: normalized.eventType,
  });
  if (!claimed) {
    return createStripeWebhookHandledResult({ duplicate: true });
  }

  try {
    if (normalized.kind === 'checkout_completed') {
      const previousBillingSnapshot = await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId: normalized.organizationId,
      });
      await upsertOrganizationBillingByOrganizationId({
        database,
        organizationId: normalized.organizationId,
        planCode: 'premium',
        stripeCustomerId: normalized.stripeCustomerId,
        stripeSubscriptionId: normalized.stripeSubscriptionId,
        stripePriceId: normalized.stripePriceId,
        billingInterval: normalized.billingInterval,
        subscriptionStatus: 'incomplete',
        cancelAtPeriodEnd: false,
        currentPeriodStart: null,
        currentPeriodEnd: null,
      });
      const nextBillingSnapshot = await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId: normalized.organizationId,
      });
      await appendOrganizationBillingAuditEvent({
        database,
        organizationId: normalized.organizationId,
        sourceKind: 'webhook_checkout_completed',
        previousSnapshot: previousBillingSnapshot,
        nextSnapshot: nextBillingSnapshot,
        stripeEventId: normalized.eventId,
        sourceContext: 'checkout_session_completed',
      });
      await markStripeWebhookEventProcessed({
        database,
        eventId: normalized.eventId,
        organizationId: normalized.organizationId,
        stripeCustomerId: normalized.stripeCustomerId,
        stripeSubscriptionId: normalized.stripeSubscriptionId,
      });
      return createStripeWebhookHandledResult({ duplicate: false });
    }

    if (normalized.kind === 'payment_method_setup_completed') {
      const billing = await selectOrganizationBillingSummary(database, normalized.organizationId);
      if (!billing || billing.planCode !== 'premium') {
        return failStripeWebhookEvent({
          database,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          failureStage: 'organization_linkage',
          failureReason: 'organization_billing_not_found',
          organizationId: normalized.organizationId,
          stripeCustomerId: normalized.stripeCustomerId,
          retryable: true,
          message: 'Organization billing linkage is not ready yet.',
        });
      }

      let setupSession;
      try {
        setupSession = await readStripeSetupCheckoutSessionSummaryById({
          env,
          sessionId: normalized.sessionId,
        });
      } catch {
        return failStripeWebhookEvent({
          database,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          failureStage: 'provider_reconciliation',
          failureReason: 'setup_session_lookup_failed',
          organizationId: normalized.organizationId,
          stripeCustomerId: normalized.stripeCustomerId,
          retryable: true,
          message: 'Stripe setup checkout session could not be reconciled yet.',
        });
      }

      const stripeCustomerId =
        setupSession.customerId ?? normalized.stripeCustomerId ?? billing.stripeCustomerId ?? null;
      if (!stripeCustomerId) {
        return failStripeWebhookEvent({
          database,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          failureStage: 'provider_reconciliation',
          failureReason: 'setup_customer_missing',
          organizationId: normalized.organizationId,
          stripeCustomerId: normalized.stripeCustomerId,
          retryable: true,
          message: 'Stripe setup checkout session did not include a customer.',
        });
      }

      const paymentMethodId =
        setupSession.setupIntentPaymentMethodId ?? normalized.setupIntentPaymentMethodId;
      if (!paymentMethodId) {
        return failStripeWebhookEvent({
          database,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          failureStage: 'provider_reconciliation',
          failureReason: 'setup_payment_method_missing',
          organizationId: normalized.organizationId,
          stripeCustomerId,
          retryable: true,
          message: 'Stripe setup checkout session did not include a payment method yet.',
        });
      }

      const previousBillingSnapshot = await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId: normalized.organizationId,
      });
      if (billing.stripeCustomerId !== stripeCustomerId) {
        await updateOrganizationBillingStripeCustomerId({
          database,
          organizationId: normalized.organizationId,
          stripeCustomerId,
        });
      }
      await updateCustomerDefaultPaymentMethod({
        env,
        customerId: stripeCustomerId,
        paymentMethodId,
      });
      if (billing.stripeSubscriptionId) {
        await updateSubscriptionDefaultPaymentMethod({
          env,
          subscriptionId: billing.stripeSubscriptionId,
          paymentMethodId,
        });
      }
      const nextBillingSnapshot = await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId: normalized.organizationId,
      });
      await appendOrganizationBillingAuditEvent({
        database,
        organizationId: normalized.organizationId,
        sourceKind: 'payment_method_registered',
        previousSnapshot: previousBillingSnapshot,
        nextSnapshot: nextBillingSnapshot,
        stripeEventId: normalized.eventId,
        sourceContext: 'checkout_session_setup_completed',
      });
      await markStripeWebhookEventProcessed({
        database,
        eventId: normalized.eventId,
        organizationId: normalized.organizationId,
        stripeCustomerId,
        stripeSubscriptionId: billing.stripeSubscriptionId,
      });
      return createStripeWebhookHandledResult({ duplicate: false });
    }

    if (normalized.kind === 'invoice_payment_event') {
      const matchedBilling = await selectOrganizationBillingByStripeIdentifiers({
        database,
        stripeCustomerId: normalized.stripeCustomerId,
        stripeSubscriptionId: normalized.stripeSubscriptionId,
      });
      if (!matchedBilling) {
        return failStripeWebhookEvent({
          database,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          failureStage: 'organization_linkage',
          failureReason: 'organization_billing_not_found',
          stripeCustomerId: normalized.stripeCustomerId,
          stripeSubscriptionId: normalized.stripeSubscriptionId,
          retryable: true,
          message: 'Organization billing linkage is not ready yet.',
        });
      }

      const documentReferences = [
        normalizeStripeInvoiceDocument(normalized.invoicePayload),
        normalized.latestChargePayload
          ? normalizeStripeChargeReceiptDocument(normalized.latestChargePayload)
          : null,
      ].filter((document): document is NonNullable<typeof document> => Boolean(document));
      await appendOrganizationBillingInvoicePaymentEvent({
        database,
        organizationId: matchedBilling.organizationId,
        stripeEventId: normalized.eventId,
        eventType: normalized.invoiceEventType,
        stripeCustomerId: normalized.stripeCustomerId,
        stripeSubscriptionId: normalized.stripeSubscriptionId,
        stripeInvoiceId: normalized.stripeInvoiceId,
        stripePaymentIntentId: normalized.stripePaymentIntentId,
        providerStatus: normalized.providerStatus,
        ownerFacingStatus: normalized.ownerFacingStatus,
        occurredAt: normalized.occurredAt,
        documentReferences,
      });

      const sourceKind =
        normalized.invoiceEventType === 'invoice_available'
          ? 'webhook_invoice_available'
          : normalized.invoiceEventType === 'payment_succeeded'
            ? 'webhook_payment_succeeded'
            : normalized.invoiceEventType === 'payment_action_required'
              ? 'webhook_payment_action_required'
              : 'webhook_payment_failed';
      const isPaymentIssueEvent =
        normalized.invoiceEventType === 'payment_failed' ||
        normalized.invoiceEventType === 'payment_action_required';
      const previousBillingSnapshot = await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId: matchedBilling.organizationId,
      });
      let nextBillingSnapshot = previousBillingSnapshot;
      let stalePaymentIssueAfterRecovery = false;

      const latestSubscription = await resolveLatestSubscriptionSummaryForInvoiceEvent({
        env,
        stripeSubscriptionId: normalized.stripeSubscriptionId,
      });
      if (latestSubscription) {
        const latestSubscriptionStatus = normalizeSubscriptionStatus(latestSubscription.status);
        if (latestSubscriptionStatus) {
          const isCanceled = latestSubscriptionStatus === 'canceled';
          const isFreeOrCanceled = latestSubscriptionStatus === 'free' || isCanceled;
          stalePaymentIssueAfterRecovery =
            isPaymentIssueEvent && isProviderRecoveredSubscriptionStatus(latestSubscriptionStatus);

          await upsertOrganizationBillingByOrganizationId({
            database,
            organizationId: matchedBilling.organizationId,
            planCode: isFreeOrCanceled ? 'free' : 'premium',
            stripeCustomerId: latestSubscription.customerId,
            stripeSubscriptionId: isFreeOrCanceled ? null : latestSubscription.id,
            stripePriceId: isFreeOrCanceled ? null : latestSubscription.priceId,
            billingInterval: isFreeOrCanceled
              ? null
              : resolveBillingIntervalFromPriceId(env, latestSubscription.priceId),
            subscriptionStatus: latestSubscriptionStatus,
            cancelAtPeriodEnd: isFreeOrCanceled ? false : latestSubscription.cancelAtPeriodEnd,
            currentPeriodStart: isFreeOrCanceled ? null : latestSubscription.currentPeriodStart,
            currentPeriodEnd: isFreeOrCanceled ? null : latestSubscription.currentPeriodEnd,
            paymentIssueOccurredAt: isPaymentIssueEvent ? normalized.occurredAt : null,
          });
          nextBillingSnapshot = await readOrganizationBillingObservationSnapshot({
            database,
            env,
            organizationId: matchedBilling.organizationId,
          });

          if (stalePaymentIssueAfterRecovery) {
            await appendOrganizationBillingSignal({
              database,
              organizationId: matchedBilling.organizationId,
              signalKind: 'reconciliation',
              signalStatus: 'resolved',
              sourceKind,
              reason: 'stale_payment_issue_after_recovery',
              appSnapshot: nextBillingSnapshot,
              stripeEventId: normalized.eventId,
              stripeCustomerId: latestSubscription.customerId,
              stripeSubscriptionId: latestSubscription.id,
              providerPlanState: isFreeOrCanceled ? 'free' : 'premium_paid',
              providerSubscriptionStatus: latestSubscription.status,
            });
          }
        } else {
          await appendOrganizationBillingSignal({
            database,
            organizationId: matchedBilling.organizationId,
            signalKind: 'reconciliation',
            signalStatus: 'unavailable',
            sourceKind,
            reason: 'provider_subscription_status_unknown',
            appSnapshot: previousBillingSnapshot,
            stripeEventId: normalized.eventId,
            stripeCustomerId: latestSubscription.customerId,
            stripeSubscriptionId: latestSubscription.id,
            providerSubscriptionStatus: latestSubscription.status,
          });
        }
      }

      if (isPaymentIssueEvent && !stalePaymentIssueAfterRecovery) {
        const notification = await sendOrganizationPaymentIssueNotification({
          database,
          env,
          organizationId: matchedBilling.organizationId,
          notificationKind:
            normalized.invoiceEventType === 'payment_action_required'
              ? 'payment_action_required_email'
              : 'payment_failed_email',
          stripeEventId: normalized.eventId,
          stripeCustomerId: normalized.stripeCustomerId,
          stripeSubscriptionId: normalized.stripeSubscriptionId,
          stripeInvoiceId: normalized.stripeInvoiceId,
        });
        if (!notification.ok && notification.retryable) {
          return failStripeWebhookEvent({
            database,
            eventId: normalized.eventId,
            eventType: normalized.eventType,
            failureStage: 'event_processing',
            failureReason: 'payment_issue_notification_delivery_failed',
            organizationId: matchedBilling.organizationId,
            stripeCustomerId: normalized.stripeCustomerId,
            stripeSubscriptionId: normalized.stripeSubscriptionId,
            retryable: true,
            message: notification.message,
          });
        }
      }

      await appendOrganizationBillingAuditEvent({
        database,
        organizationId: matchedBilling.organizationId,
        sourceKind,
        previousSnapshot: previousBillingSnapshot,
        nextSnapshot: nextBillingSnapshot,
        stripeEventId: normalized.eventId,
        sourceContext: stalePaymentIssueAfterRecovery
          ? `${normalized.eventType}:stale_after_recovery`
          : normalized.eventType,
      });
      await markStripeWebhookEventProcessed({
        database,
        eventId: normalized.eventId,
        organizationId: matchedBilling.organizationId,
        stripeCustomerId: normalized.stripeCustomerId,
        stripeSubscriptionId: normalized.stripeSubscriptionId,
      });
      return createStripeWebhookHandledResult({ duplicate: false });
    }

    const matchedBilling = await selectOrganizationBillingByStripeIdentifiers({
      database,
      stripeCustomerId: normalized.stripeCustomerId,
      stripeSubscriptionId: normalized.stripeSubscriptionId,
    });
    if (!matchedBilling) {
      return failStripeWebhookEvent({
        database,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        failureStage: 'organization_linkage',
        failureReason: 'organization_billing_not_found',
        stripeCustomerId: normalized.stripeCustomerId,
        stripeSubscriptionId: normalized.stripeSubscriptionId,
        retryable: true,
        message: 'Organization billing linkage is not ready yet.',
      });
    }

    const latestSubscription = await resolveLatestSubscriptionSummary({
      env,
      eventType: normalized.eventType,
      fallback: normalized.subscription,
    });
    if (!latestSubscription) {
      const currentBillingSnapshot = await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId: matchedBilling.organizationId,
      });
      await appendOrganizationBillingSignal({
        database,
        organizationId: matchedBilling.organizationId,
        signalKind: 'reconciliation',
        signalStatus: 'unavailable',
        sourceKind: 'webhook_subscription_lifecycle',
        reason: 'latest_subscription_lookup_failed',
        appSnapshot: currentBillingSnapshot,
        stripeEventId: normalized.eventId,
        stripeCustomerId: normalized.stripeCustomerId,
        stripeSubscriptionId: normalized.stripeSubscriptionId,
      });
      return failStripeWebhookEvent({
        database,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        failureStage: 'provider_reconciliation',
        failureReason: 'latest_subscription_lookup_failed',
        organizationId: matchedBilling.organizationId,
        stripeCustomerId: normalized.stripeCustomerId,
        stripeSubscriptionId: normalized.stripeSubscriptionId,
        retryable: true,
        message: 'Stripe subscription state could not be reconciled yet.',
      });
    }

    const subscriptionStatus = normalizeSubscriptionStatus(latestSubscription.status);
    if (!subscriptionStatus) {
      return failStripeWebhookEvent({
        database,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        failureStage: 'event_normalization',
        failureReason: 'unsupported_subscription_status',
        organizationId: matchedBilling.organizationId,
        stripeCustomerId: latestSubscription.customerId,
        stripeSubscriptionId: latestSubscription.id,
      });
    }

    const previousBillingSnapshot = await readOrganizationBillingObservationSnapshot({
      database,
      env,
      organizationId: matchedBilling.organizationId,
    });
    const preSyncReconciliationCheck = evaluateReconciliationMismatchReason({
      appSnapshot: previousBillingSnapshot,
      providerSubscription: latestSubscription,
    });
    if (preSyncReconciliationCheck.reason) {
      await appendOrganizationBillingSignal({
        database,
        organizationId: matchedBilling.organizationId,
        signalKind: 'reconciliation',
        signalStatus: 'mismatch',
        sourceKind: 'webhook_subscription_lifecycle',
        reason: preSyncReconciliationCheck.reason,
        appSnapshot: previousBillingSnapshot,
        stripeEventId: normalized.eventId,
        stripeCustomerId: latestSubscription.customerId,
        stripeSubscriptionId: latestSubscription.id,
        providerPlanState: preSyncReconciliationCheck.providerPlanState,
        providerSubscriptionStatus: latestSubscription.status,
      });
    }
    const isCanceled = subscriptionStatus === 'canceled';
    await upsertOrganizationBillingByOrganizationId({
      database,
      organizationId: matchedBilling.organizationId,
      planCode: isCanceled ? 'free' : 'premium',
      stripeCustomerId: latestSubscription.customerId,
      stripeSubscriptionId: isCanceled ? null : latestSubscription.id,
      stripePriceId: isCanceled ? null : latestSubscription.priceId,
      billingInterval: isCanceled
        ? null
        : resolveBillingIntervalFromPriceId(env, latestSubscription.priceId),
      subscriptionStatus: isCanceled ? 'canceled' : subscriptionStatus,
      cancelAtPeriodEnd: isCanceled ? false : latestSubscription.cancelAtPeriodEnd,
      currentPeriodStart: isCanceled ? null : latestSubscription.currentPeriodStart,
      currentPeriodEnd: isCanceled ? null : latestSubscription.currentPeriodEnd,
      paymentIssueOccurredAt:
        subscriptionStatus === 'past_due' ||
        subscriptionStatus === 'unpaid' ||
        subscriptionStatus === 'incomplete'
          ? normalized.occurredAt
          : null,
    });
    const syncedBillingSnapshot = await readOrganizationBillingObservationSnapshot({
      database,
      env,
      organizationId: matchedBilling.organizationId,
    });
    await appendOrganizationBillingAuditEvent({
      database,
      organizationId: matchedBilling.organizationId,
      sourceKind: 'webhook_subscription_lifecycle',
      previousSnapshot: previousBillingSnapshot,
      nextSnapshot: syncedBillingSnapshot,
      stripeEventId: normalized.eventId,
      sourceContext: normalized.eventType,
    });

    const reconciliationCheck = evaluateReconciliationMismatchReason({
      appSnapshot: syncedBillingSnapshot,
      providerSubscription: latestSubscription,
    });
    if (reconciliationCheck.reason) {
      await appendOrganizationBillingSignal({
        database,
        organizationId: matchedBilling.organizationId,
        signalKind: 'reconciliation',
        signalStatus: 'mismatch',
        sourceKind: 'webhook_subscription_lifecycle',
        reason: reconciliationCheck.reason,
        appSnapshot: syncedBillingSnapshot,
        stripeEventId: normalized.eventId,
        stripeCustomerId: latestSubscription.customerId,
        stripeSubscriptionId: latestSubscription.id,
        providerPlanState: reconciliationCheck.providerPlanState,
        providerSubscriptionStatus: latestSubscription.status,
      });
    } else {
      await appendResolvedBillingSignalIfNeeded({
        database,
        organizationId: matchedBilling.organizationId,
        signalKind: 'reconciliation',
        sourceKind: 'webhook_subscription_lifecycle',
        reason: 'provider_and_app_state_aligned',
        appSnapshot: syncedBillingSnapshot,
        stripeEventId: normalized.eventId,
        stripeCustomerId: latestSubscription.customerId,
        stripeSubscriptionId: latestSubscription.id,
        providerPlanState: reconciliationCheck.providerPlanState,
        providerSubscriptionStatus: latestSubscription.status,
      });
    }

    if (normalized.kind === 'trial_will_end') {
      const reminder = await sendOrganizationTrialWillEndReminder({
        database,
        env,
        organizationId: matchedBilling.organizationId,
        stripeEventId: normalized.eventId,
        stripeCustomerId: latestSubscription.customerId,
        stripeSubscriptionId: latestSubscription.id,
      });
      if (!reminder.ok) {
        return failStripeWebhookEvent({
          database,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          failureStage: 'event_processing',
          failureReason: reminder.retryable
            ? 'trial_reminder_delivery_failed'
            : reminder.failureReason === 'owner_not_found'
              ? 'trial_reminder_owner_not_found'
              : 'trial_reminder_config_missing',
          organizationId: matchedBilling.organizationId,
          stripeCustomerId: latestSubscription.customerId,
          stripeSubscriptionId: latestSubscription.id,
          retryable: reminder.retryable,
          message: reminder.message,
        });
      }
    }

    if (
      subscriptionStatus === 'trialing' &&
      latestSubscription.currentPeriodEnd &&
      latestSubscription.currentPeriodEnd.getTime() <= Date.now()
    ) {
      const completion = await applyOrganizationPremiumTrialCompletion({
        database,
        env,
        organizationId: matchedBilling.organizationId,
      });
      if (!completion.ok) {
        const currentBillingSnapshot = await readOrganizationBillingObservationSnapshot({
          database,
          env,
          organizationId: matchedBilling.organizationId,
        });
        await appendOrganizationBillingSignal({
          database,
          organizationId: matchedBilling.organizationId,
          signalKind: 'reconciliation',
          signalStatus: completion.status === 503 ? 'pending' : 'unavailable',
          sourceKind: 'webhook_trial_completion',
          reason:
            completion.status === 503
              ? 'trial_completion_pending'
              : 'trial_completion_not_ready_or_unavailable',
          appSnapshot: currentBillingSnapshot,
          stripeEventId: normalized.eventId,
          stripeCustomerId: latestSubscription.customerId,
          stripeSubscriptionId: latestSubscription.id,
          providerPlanState: reconciliationCheck.providerPlanState,
          providerSubscriptionStatus: latestSubscription.status,
        });
        return failStripeWebhookEvent({
          database,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          failureStage: 'provider_reconciliation',
          failureReason:
            completion.status === 503 ? 'trial_completion_pending' : 'trial_completion_not_ready',
          organizationId: matchedBilling.organizationId,
          stripeCustomerId: latestSubscription.customerId,
          stripeSubscriptionId: latestSubscription.id,
          retryable: true,
          message: completion.message,
        });
      }

      const completedBillingSnapshot = await readOrganizationBillingObservationSnapshot({
        database,
        env,
        organizationId: matchedBilling.organizationId,
      });
      await appendOrganizationBillingAuditEvent({
        database,
        organizationId: matchedBilling.organizationId,
        sourceKind: 'webhook_trial_completion',
        previousSnapshot: syncedBillingSnapshot,
        nextSnapshot: completedBillingSnapshot,
        stripeEventId: normalized.eventId,
        sourceContext: completion.message,
      });

      const postCompletionReconciliationCheck = evaluateReconciliationMismatchReason({
        appSnapshot: completedBillingSnapshot,
        providerSubscription: latestSubscription,
      });
      if (postCompletionReconciliationCheck.reason) {
        await appendOrganizationBillingSignal({
          database,
          organizationId: matchedBilling.organizationId,
          signalKind: 'reconciliation',
          signalStatus: 'pending',
          sourceKind: 'webhook_trial_completion',
          reason: `provider_state_pending_after_trial_completion:${postCompletionReconciliationCheck.reason}`,
          appSnapshot: completedBillingSnapshot,
          stripeEventId: normalized.eventId,
          stripeCustomerId: latestSubscription.customerId,
          stripeSubscriptionId: latestSubscription.id,
          providerPlanState: postCompletionReconciliationCheck.providerPlanState,
          providerSubscriptionStatus: latestSubscription.status,
        });
      } else {
        await appendResolvedBillingSignalIfNeeded({
          database,
          organizationId: matchedBilling.organizationId,
          signalKind: 'reconciliation',
          sourceKind: 'webhook_trial_completion',
          reason: 'trial_completion_reconciled',
          appSnapshot: completedBillingSnapshot,
          stripeEventId: normalized.eventId,
          stripeCustomerId: latestSubscription.customerId,
          stripeSubscriptionId: latestSubscription.id,
          providerPlanState: postCompletionReconciliationCheck.providerPlanState,
          providerSubscriptionStatus: latestSubscription.status,
        });
      }
    }

    await markStripeWebhookEventProcessed({
      database,
      eventId: normalized.eventId,
      organizationId: matchedBilling.organizationId,
      stripeCustomerId: latestSubscription.customerId,
      stripeSubscriptionId: isCanceled ? null : latestSubscription.id,
    });
    return createStripeWebhookHandledResult({ duplicate: false });
  } catch {
    return failStripeWebhookEvent({
      database,
      eventId: normalized.eventId,
      eventType: normalized.eventType,
      failureStage: 'event_processing',
      failureReason: 'unexpected_processing_error',
      organizationId: null,
      stripeCustomerId: normalized.stripeCustomerId,
      stripeSubscriptionId:
        'stripeSubscriptionId' in normalized ? normalized.stripeSubscriptionId : null,
      retryable: true,
      message: 'Stripe webhook processing failed before synchronization completed.',
    });
  }
};

export const recordStripeWebhookSignatureFailure = async ({
  database,
  signatureStatus = 'invalid',
}: {
  database: AuthRuntimeDatabase;
  signatureStatus?: Exclude<StripeWebhookSignatureVerificationStatus, 'verified'>;
}) => {
  const failureReason =
    signatureStatus === 'missing'
      ? 'signature_missing'
      : signatureStatus === 'expired'
        ? 'signature_expired'
        : signatureStatus === 'mismatched'
          ? 'signature_mismatched'
          : 'invalid_signature';
  await recordStripeWebhookFailure({
    database,
    failureStage: 'signature_verification',
    failureReason,
  });
};

export const recordStripeWebhookPayloadFailure = async ({
  database,
  eventId,
  eventType,
}: {
  database: AuthRuntimeDatabase;
  eventId?: string | null;
  eventType?: string | null;
}) => {
  await recordStripeWebhookFailure({
    database,
    eventId,
    eventType,
    failureStage: 'payload_parse',
    failureReason: 'invalid_payload',
  });
};
