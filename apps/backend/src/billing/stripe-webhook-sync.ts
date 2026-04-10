import { and, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import {
  applyOrganizationPremiumTrialCompletion,
  resolveBillingIntervalFromPriceId,
  selectOrganizationBillingByStripeIdentifiers,
  upsertOrganizationBillingByOrganizationId,
  type OrganizationBillingSubscriptionStatus,
} from './organization-billing.js';
import {
  appendOrganizationBillingAuditEvent,
  appendOrganizationBillingSignal,
  appendResolvedBillingSignalIfNeeded,
  evaluateReconciliationMismatchReason,
  readOrganizationBillingObservationSnapshot,
} from './organization-billing-observability.js';
import { sendOrganizationTrialWillEndReminder } from './organization-billing-notifications.js';
import {
  readStripeBillingCheckoutMetadata,
  readStripeCheckoutSessionSummary,
  readStripeSubscriptionSummary,
  readStripeSubscriptionSummaryById,
  type StripeSubscriptionSummary,
  type StripeWebhookEvent,
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
  | 'invalid_payload'
  | 'invalid_checkout_session_payload'
  | 'invalid_subscription_payload'
  | 'unsupported_subscription_status'
  | 'organization_billing_not_found'
  | 'latest_subscription_lookup_failed'
  | 'trial_completion_pending'
  | 'trial_completion_not_ready'
  | 'trial_reminder_owner_not_found'
  | 'trial_reminder_config_missing'
  | 'trial_reminder_delivery_failed'
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
      kind: 'subscription_lifecycle';
      eventId: string;
      eventType: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string;
      subscription: StripeSubscriptionSummary;
    }
  | {
      kind: 'trial_will_end';
      eventId: string;
      eventType: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string;
      subscription: StripeSubscriptionSummary;
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

  return Boolean(retryRows[0]);
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
    if (!billingMetadata) {
      return { kind: 'not_billing' };
    }

    return {
      kind: 'checkout_completed',
      eventId: event.id,
      eventType: event.type,
      organizationId: billingMetadata.organizationId,
      stripeCustomerId: session.customerId,
      stripeSubscriptionId: session.subscriptionId,
      stripePriceId:
        billingMetadata.billingInterval === 'month'
          ? env.STRIPE_PREMIUM_MONTHLY_PRICE_ID?.trim() ?? null
          : env.STRIPE_PREMIUM_YEARLY_PRICE_ID?.trim() ?? null,
      billingInterval: billingMetadata.billingInterval,
    };
  }

  if (
    event.type === 'customer.subscription.created'
    || event.type === 'customer.subscription.updated'
    || event.type === 'customer.subscription.deleted'
    || event.type === 'customer.subscription.trial_will_end'
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
          stripeCustomerId: subscription.customerId,
          stripeSubscriptionId: subscription.id,
          subscription,
        }
      : {
          kind: 'subscription_lifecycle',
          eventId: event.id,
          eventType: event.type,
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
      subscriptionStatus === 'trialing'
      && latestSubscription.currentPeriodEnd
      && latestSubscription.currentPeriodEnd.getTime() <= Date.now()
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
      stripeSubscriptionId: normalized.stripeSubscriptionId,
      retryable: true,
      message: 'Stripe webhook processing failed before synchronization completed.',
    });
  }
};

export const recordStripeWebhookSignatureFailure = async ({
  database,
}: {
  database: AuthRuntimeDatabase;
}) => {
  await recordStripeWebhookFailure({
    database,
    failureStage: 'signature_verification',
    failureReason: 'invalid_signature',
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
