import {
  BILLING_HANDOFF_REUSE_WINDOW_MS,
  type OrganizationBillingOperationAttempt,
  type OrganizationBillingOperationPurpose,
} from '../../domain/billing/organization-billing-operations.js';
import {
  ORGANIZATION_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE,
  ORGANIZATION_PREMIUM_TRIAL_DURATION_DAYS,
} from '../../domain/billing/organization-billing.js';
import {
  forbidden,
  jsonResult,
  unauthorized,
  validationError,
  type JsonRouteResult,
} from '../../shared/route-result.js';
import {
  buildOrganizationBillingCatalog,
  resolveOrganizationBillingPriceId,
} from './billing.catalog.js';
import { buildBillingActionEnvelope } from './billing.presenter.js';
import type { BillingIdentity, BillingRouteContext } from './billing.route-context.js';
import type {
  OrganizationBillingCheckoutBody,
  OrganizationBillingPaymentMethodBody,
  OrganizationBillingPortalBody,
  OrganizationBillingTrialBody,
  OrganizationBillingTrialCompletionBody,
} from './billing.schemas.js';

type OwnerActionContext =
  | {
      ok: true;
      identity: BillingIdentity;
      organizationId: string;
      role: 'owner';
    }
  | {
      ok: false;
      result: JsonRouteResult;
    };

const resolveOwnerActionContext = async ({
  ctx,
  headers,
  requestedOrganizationId,
}: {
  ctx: BillingRouteContext;
  headers: Headers;
  requestedOrganizationId?: string;
}): Promise<OwnerActionContext> => {
  const identity = await ctx.getSessionIdentity(headers);
  if (!identity) {
    return {
      ok: false,
      result: unauthorized(),
    };
  }

  const organizationId = ctx.resolveOrganizationId({
    requestedOrganizationId,
    activeOrganizationId: identity.activeOrganizationId,
  });
  if (!organizationId) {
    return {
      ok: false,
      result: validationError('organizationId is required.'),
    };
  }

  const role = await ctx.readOrganizationMembershipRole({
    organizationId,
    userId: identity.userId,
  });
  if (role !== 'owner') {
    return {
      ok: false,
      result: forbidden(),
    };
  }

  return {
    ok: true,
    identity,
    organizationId,
    role,
  };
};

const buildActionEnvelope = (
  ctx: BillingRouteContext,
  input: Omit<Parameters<typeof buildBillingActionEnvelope>[0], 'store' | 'env'>,
) =>
  buildBillingActionEnvelope({
    store: ctx.store,
    env: ctx.env,
    ...input,
  });

const resolveDefaultPremiumTrialPriceConfig = (
  ctx: BillingRouteContext,
): {
  priceId: string;
  billingInterval: 'month' | 'year';
} | null => {
  if (ctx.env.STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED !== 'true') {
    return null;
  }

  const catalogResult = buildOrganizationBillingCatalog(ctx.env);
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

const toBillingOperationFailureMessage = (error: unknown, fallbackMessage: string): string => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return fallbackMessage;
};

const buildContractsUrl = (ctx: BillingRouteContext) => {
  const webBaseUrl = (ctx.env.WEB_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  return `${webBaseUrl}/admin/contracts`;
};

const isActivePremiumSubscriptionStatus = (value: unknown) =>
  value === 'trialing' ||
  value === 'active' ||
  value === 'past_due' ||
  value === 'unpaid' ||
  value === 'incomplete';

const operationConflictResult = async ({
  ctx,
  organizationId,
  role,
}: {
  ctx: BillingRouteContext;
  organizationId: string;
  role: 'owner';
}) =>
  jsonResult(
    await buildActionEnvelope(ctx, {
      organizationId,
      role,
      status: 'conflict',
      message: 'Billing operation is already processing. Please retry shortly.',
    }),
    409,
  );

const reusedHandoffResult = async ({
  ctx,
  organizationId,
  role,
  purpose,
  attempt,
  message,
}: {
  ctx: BillingRouteContext;
  organizationId: string;
  role: 'owner';
  purpose: OrganizationBillingOperationPurpose;
  attempt: OrganizationBillingOperationAttempt;
  message: string;
}) =>
  jsonResult(
    await buildActionEnvelope(ctx, {
      organizationId,
      role,
      status: attempt.state === 'succeeded' ? 'succeeded' : 'processing',
      message,
      handoffAttempt: attempt,
      handoffPurpose: purpose,
      handoffReused: true,
    }),
    200,
  );

export const createSubscriptionCheckoutHandoff = async ({
  ctx,
  body,
  headers,
}: {
  ctx: BillingRouteContext;
  body: OrganizationBillingCheckoutBody;
  headers: Headers;
}): Promise<JsonRouteResult> => {
  const ownerContext = await resolveOwnerActionContext({
    ctx,
    headers,
    requestedOrganizationId: body.organizationId,
  });
  if (!ownerContext.ok) {
    return ownerContext.result;
  }
  const { identity, organizationId, role } = ownerContext;

  const resolvedPrice = resolveOrganizationBillingPriceId({
    catalogResult: buildOrganizationBillingCatalog(ctx.env),
    interval: body.billingInterval,
  });
  if (!ctx.env.STRIPE_SECRET_KEY?.trim() || !resolvedPrice.ok) {
    return jsonResult(
      await buildActionEnvelope(ctx, {
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

  const billing = await ctx.store.selectSummary(organizationId);
  if (billing && isActivePremiumSubscriptionStatus(billing.subscriptionStatus)) {
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'conflict',
        message: 'Organization already has an active premium subscription.',
      }),
      409,
    );
  }

  const now = new Date();
  const operation = await ctx.operationStore.createAttempt({
    organizationId,
    purpose: 'paid_checkout',
    billingInterval: body.billingInterval,
    createdByUserId: identity.userId,
    now,
  });
  if (operation.reused && operation.attempt.handoffUrl) {
    return reusedHandoffResult({
      ctx,
      organizationId,
      role,
      purpose: 'paid_checkout',
      attempt: operation.attempt,
      message: 'Reusing the active Stripe Checkout handoff.',
    });
  }
  if (operation.reused) {
    return operationConflictResult({ ctx, organizationId, role });
  }

  const contractsUrl = buildContractsUrl(ctx);
  try {
    const provider = ctx.createProvider({ env: ctx.env });
    let stripeCustomerId = billing?.stripeCustomerId ?? null;
    if (!stripeCustomerId) {
      const previousBillingSnapshot = await ctx.store.readObservationSnapshot({
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
      await ctx.store.updateStripeCustomerId({
        organizationId,
        stripeCustomerId,
      });
      const nextBillingSnapshot = await ctx.store.readObservationSnapshot({
        organizationId,
      });
      await ctx.store.appendAuditEvent({
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
    const succeededAttempt = await ctx.operationStore.markSucceeded({
      attemptId: operation.attempt.id,
      handoffUrl: session.url,
      handoffExpiresAt: new Date(now.getTime() + BILLING_HANDOFF_REUSE_WINDOW_MS),
      stripeCustomerId,
      stripeCheckoutSessionId: session.id,
    });

    await ctx.store.appendAuditEvent({
      organizationId,
      sourceKind: 'paid_checkout_started',
      previousSnapshot: await ctx.store.readObservationSnapshot({ organizationId }),
      nextSnapshot: await ctx.store.readObservationSnapshot({ organizationId }),
      sourceContext: 'owner_started_paid_checkout_handoff',
    });

    return jsonResult(
      await buildActionEnvelope(ctx, {
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
    const message = toBillingOperationFailureMessage(error, 'Stripe Checkout creation failed.');
    await ctx.operationStore.markFailed({
      attemptId: operation.attempt.id,
      failureReason: message,
    });
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'failed',
        message,
      }),
      500,
    );
  }
};

export const startTrialSubscription = async ({
  ctx,
  body,
  headers,
}: {
  ctx: BillingRouteContext;
  body: OrganizationBillingTrialBody;
  headers: Headers;
}): Promise<JsonRouteResult> => {
  const ownerContext = await resolveOwnerActionContext({
    ctx,
    headers,
    requestedOrganizationId: body.organizationId,
  });
  if (!ownerContext.ok) {
    return ownerContext.result;
  }
  const { identity, organizationId, role } = ownerContext;

  const billing = await ctx.store.selectSummary(organizationId);
  if (billing && isActivePremiumSubscriptionStatus(billing.subscriptionStatus)) {
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'conflict',
        message: ORGANIZATION_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE,
      }),
      409,
    );
  }
  if (await ctx.store.hasStartedPremiumTrial({ organizationId })) {
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'conflict',
        message: ORGANIZATION_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE,
      }),
      409,
    );
  }

  const shouldCreateStripeTrialSubscription =
    ctx.env.STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED === 'true';
  const defaultTrialPrice = resolveDefaultPremiumTrialPriceConfig(ctx);
  if (
    shouldCreateStripeTrialSubscription &&
    ctx.env.STRIPE_SECRET_KEY?.trim() &&
    !defaultTrialPrice
  ) {
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'failed',
        message: 'Stripe premium trial price id is not configured.',
      }),
      422,
    );
  }

  const operation = await ctx.operationStore.createAttempt({
    organizationId,
    purpose: 'trial_start',
    createdByUserId: identity.userId,
  });
  if (operation.reused) {
    return operationConflictResult({ ctx, organizationId, role });
  }
  try {
    const previousBillingSnapshot = await ctx.store.readObservationSnapshot({
      organizationId,
    });
    const e2eStripeTestClockId = ctx.resolveE2eStripeTestClockId(headers);
    let stripeCustomerId = billing?.stripeCustomerId ?? null;
    let stripeSubscriptionId: string | null = null;
    let stripePriceId: string | null = null;
    let billingInterval: 'month' | 'year' | null = null;
    let trialStartedAt: Date | undefined;
    let trialEndsAt: Date | undefined;

    if (ctx.env.STRIPE_SECRET_KEY?.trim() && defaultTrialPrice) {
      const provider = ctx.createProvider({
        env: ctx.env,
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

    await ctx.store.startPremiumTrial({
      organizationId,
      trialStartedAt,
      trialEndsAt,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId,
      billingInterval,
    });
    const nextBillingSnapshot = await ctx.store.readObservationSnapshot({
      organizationId,
    });
    await ctx.store.appendAuditEvent({
      organizationId,
      sourceKind: 'trial_start',
      previousSnapshot: previousBillingSnapshot,
      nextSnapshot: nextBillingSnapshot,
      sourceContext: 'owner_started_premium_trial',
    });
    await ctx.operationStore.markSucceeded({
      attemptId: operation.attempt.id,
      stripeCustomerId,
      stripeSubscriptionId,
    });

    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'succeeded',
        message: `Started a ${ORGANIZATION_PREMIUM_TRIAL_DURATION_DAYS}-day premium trial.`,
      }),
      200,
    );
  } catch (error) {
    const message = toBillingOperationFailureMessage(error, 'Premium trial start failed.');
    await ctx.operationStore.markFailed({
      attemptId: operation.attempt.id,
      failureReason: message,
    });
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'failed',
        message,
      }),
      500,
    );
  }
};

export const createSetupCheckoutHandoff = async ({
  ctx,
  body,
  headers,
}: {
  ctx: BillingRouteContext;
  body: OrganizationBillingPaymentMethodBody;
  headers: Headers;
}): Promise<JsonRouteResult> => {
  const ownerContext = await resolveOwnerActionContext({
    ctx,
    headers,
    requestedOrganizationId: body.organizationId,
  });
  if (!ownerContext.ok) {
    return ownerContext.result;
  }
  const { identity, organizationId, role } = ownerContext;

  if (!ctx.env.STRIPE_SECRET_KEY?.trim()) {
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'failed',
        message: 'Stripe billing is not configured.',
      }),
      422,
    );
  }

  const billing = await ctx.store.selectSummary(organizationId);
  if (billing?.planCode !== 'premium' || billing.subscriptionStatus !== 'trialing') {
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'conflict',
        message: 'Organization does not have an active premium trial.',
      }),
      409,
    );
  }

  const now = new Date();
  const operation = await ctx.operationStore.createAttempt({
    organizationId,
    purpose: 'payment_method_setup',
    createdByUserId: identity.userId,
    now,
  });
  if (operation.reused && operation.attempt.handoffUrl) {
    return reusedHandoffResult({
      ctx,
      organizationId,
      role,
      purpose: 'payment_method_setup',
      attempt: operation.attempt,
      message: 'Reusing the active payment method setup handoff.',
    });
  }
  if (operation.reused) {
    return operationConflictResult({ ctx, organizationId, role });
  }

  try {
    const provider = ctx.createProvider({ env: ctx.env });
    let customerId = billing.stripeCustomerId;
    if (!customerId) {
      const previousBillingSnapshot = await ctx.store.readObservationSnapshot({
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
      await ctx.store.updateStripeCustomerId({
        organizationId,
        stripeCustomerId: customerId,
      });
      const nextBillingSnapshot = await ctx.store.readObservationSnapshot({
        organizationId,
      });
      await ctx.store.appendAuditEvent({
        organizationId,
        sourceKind: 'payment_method_customer_linked',
        previousSnapshot: previousBillingSnapshot,
        nextSnapshot: nextBillingSnapshot,
        sourceContext: 'stripe_customer_created_for_payment_method_registration',
      });
    }

    const contractsUrl = buildContractsUrl(ctx);
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
    const succeededAttempt = await ctx.operationStore.markSucceeded({
      attemptId: operation.attempt.id,
      handoffUrl: session.url,
      handoffExpiresAt: new Date(now.getTime() + BILLING_HANDOFF_REUSE_WINDOW_MS),
      stripeCustomerId: customerId,
      stripeSubscriptionId: billing.stripeSubscriptionId ?? null,
      stripeCheckoutSessionId: session.id,
    });

    return jsonResult(
      await buildActionEnvelope(ctx, {
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
    const message = toBillingOperationFailureMessage(error, 'Payment method setup handoff failed.');
    await ctx.operationStore.markFailed({
      attemptId: operation.attempt.id,
      failureReason: message,
    });
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'failed',
        message,
      }),
      500,
    );
  }
};

export const completeTrialLifecycle = async ({
  ctx,
  body,
  headers,
}: {
  ctx: BillingRouteContext;
  body: OrganizationBillingTrialCompletionBody;
  headers: Headers;
}): Promise<JsonRouteResult> => {
  const ownerContext = await resolveOwnerActionContext({
    ctx,
    headers,
    requestedOrganizationId: body.organizationId,
  });
  if (!ownerContext.ok) {
    return ownerContext.result;
  }
  const { organizationId, role } = ownerContext;

  const previousBillingSnapshot = await ctx.store.readObservationSnapshot({
    organizationId,
  });
  const completion = await ctx.store.applyTrialCompletion({
    organizationId,
  });
  if (!completion.ok) {
    const currentBillingSnapshot = await ctx.store.readObservationSnapshot({
      organizationId,
    });
    await ctx.store.appendSignal({
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
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: completion.status === 409 ? 'conflict' : 'failed',
        message: completion.message,
      }),
      completion.status,
    );
  }

  const nextBillingSnapshot = await ctx.store.readObservationSnapshot({
    organizationId,
  });
  await ctx.store.appendAuditEvent({
    organizationId,
    sourceKind: 'trial_completion',
    previousSnapshot: previousBillingSnapshot,
    nextSnapshot: nextBillingSnapshot,
    sourceContext: completion.message,
  });
  await ctx.store.appendResolvedSignalIfNeeded({
    organizationId,
    signalKind: 'reconciliation',
    sourceKind: 'trial_completion',
    reason: 'trial_completion_applied',
    appSnapshot: nextBillingSnapshot,
  });

  return jsonResult(
    await buildActionEnvelope(ctx, {
      organizationId,
      role,
      status: 'succeeded',
      message: completion.message,
    }),
    200,
  );
};

export const createSubscriptionUpdatePortalHandoff = async ({
  ctx,
  body,
  headers,
}: {
  ctx: BillingRouteContext;
  body: OrganizationBillingPortalBody;
  headers: Headers;
}): Promise<JsonRouteResult> => {
  const ownerContext = await resolveOwnerActionContext({
    ctx,
    headers,
    requestedOrganizationId: body.organizationId,
  });
  if (!ownerContext.ok) {
    return ownerContext.result;
  }
  const { identity, organizationId, role } = ownerContext;

  if (!ctx.env.STRIPE_SECRET_KEY?.trim()) {
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'failed',
        message: 'Stripe billing is not configured.',
      }),
      422,
    );
  }

  const billing = await ctx.store.selectSummary(organizationId);
  if (
    !billing?.stripeCustomerId ||
    !billing.stripeSubscriptionId ||
    billing.planCode !== 'premium' ||
    !isActivePremiumSubscriptionStatus(billing.subscriptionStatus)
  ) {
    return jsonResult(
      await buildActionEnvelope(ctx, {
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
  const operation = await ctx.operationStore.createAttempt({
    organizationId,
    purpose: 'billing_portal',
    stripeSubscriptionId: billing.stripeSubscriptionId,
    createdByUserId: identity.userId,
    now,
  });
  if (operation.reused && operation.attempt.handoffUrl) {
    return reusedHandoffResult({
      ctx,
      organizationId,
      role,
      purpose: 'billing_portal',
      attempt: operation.attempt,
      message: 'Reusing the active billing portal handoff.',
    });
  }
  if (operation.reused) {
    return operationConflictResult({ ctx, organizationId, role });
  }

  try {
    const contractsUrl = buildContractsUrl(ctx);
    const provider = ctx.createProvider({ env: ctx.env });
    const portalSession = await provider.createBillingPortalSession({
      customerId: billing.stripeCustomerId,
      returnUrl: contractsUrl,
      idempotencyKey: operation.attempt.idempotencyKey,
      flow: {
        type: 'subscription_update',
        subscriptionId: billing.stripeSubscriptionId,
      },
    });
    const succeededAttempt = await ctx.operationStore.markSucceeded({
      attemptId: operation.attempt.id,
      handoffUrl: portalSession.url,
      handoffExpiresAt: new Date(now.getTime() + BILLING_HANDOFF_REUSE_WINDOW_MS),
      stripeCustomerId: billing.stripeCustomerId,
      stripeSubscriptionId: billing.stripeSubscriptionId,
      stripePortalSessionId: portalSession.id,
    });

    return jsonResult(
      await buildActionEnvelope(ctx, {
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
    await ctx.operationStore.markFailed({
      attemptId: operation.attempt.id,
      failureReason: message,
    });
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'failed',
        message,
      }),
      500,
    );
  }
};
