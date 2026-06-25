import { BillingClientError } from '@repo/billing-client';
import type { BillingApiHandoffRequest, BillingApiHandoffResponse } from '@repo/billing-types';
import {
  BILLING_HANDOFF_REUSE_WINDOW_MS,
  type OrganizationBillingOperationAttempt,
  type OrganizationBillingOperationPurpose,
} from '../../domain/billing/organization-billing-operations.js';
import {
  RESERVE_APP_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE,
  RESERVE_APP_PREMIUM_TRIAL_DURATION_DAYS,
} from './policies/reserve-app-billing-policy.js';
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
import {
  buildBillingApiOrganizationSubjectSyncRequest,
  resolveBillingApiActionClient,
  toBillingApiOrganizationSubjectInput,
  type BillingApiActionClient,
  type BillingApiClientDisabledReason,
} from './billing-api-client.js';
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

const toBillingApiActionFailure = (
  error: unknown,
  fallbackMessage: string,
): {
  statusCode: 409 | 500;
  actionStatus: 'conflict' | 'failed';
  attemptState: 'conflict' | 'failed';
  message: string;
} => {
  const statusCode = error instanceof BillingClientError && error.status === 409 ? 409 : 500;
  return {
    statusCode,
    actionStatus: statusCode === 409 ? 'conflict' : 'failed',
    attemptState: statusCode === 409 ? 'conflict' : 'failed',
    message: toBillingOperationFailureMessage(error, fallbackMessage),
  };
};

const toBillingApiActionDisabledMessage = (disabledReason: BillingApiClientDisabledReason) => {
  if (disabledReason === 'missing_base_url') {
    return 'Billing API base URL is not configured.';
  }
  if (disabledReason === 'missing_api_key') {
    return 'Billing API key is not configured.';
  }
  return 'Billing API actions are disabled.';
};

const billingApiActionUnavailableResult = async ({
  ctx,
  organizationId,
  role,
  disabledReason,
}: {
  ctx: BillingRouteContext;
  organizationId: string;
  role: 'owner';
  disabledReason: BillingApiClientDisabledReason;
}) =>
  jsonResult(
    await buildActionEnvelope(ctx, {
      organizationId,
      role,
      status: 'failed',
      message: toBillingApiActionDisabledMessage(disabledReason),
    }),
    422,
  );

const buildBillingApiActionSubject = async ({
  ctx,
  identity,
  organizationId,
}: {
  ctx: BillingRouteContext;
  identity: BillingIdentity;
  organizationId: string;
}) => {
  const organizationSubject = await ctx.readOrganizationSubject({ organizationId });
  return {
    organizationId,
    organizationName: organizationSubject?.name ?? organizationId,
    organizationSlug: organizationSubject?.slug ?? organizationId,
    billingEmail: identity.email,
  };
};

const syncBillingApiActionSubject = async ({
  client,
  ctx,
  identity,
  organizationId,
  attempt,
}: {
  client: Pick<BillingApiActionClient, 'syncSubject'>;
  ctx: BillingRouteContext;
  identity: BillingIdentity;
  organizationId: string;
  attempt: OrganizationBillingOperationAttempt;
}) => {
  const subject = await buildBillingApiActionSubject({ ctx, identity, organizationId });
  const billingSubject = toBillingApiOrganizationSubjectInput(subject);
  await client.syncSubject(
    billingSubject,
    buildBillingApiOrganizationSubjectSyncRequest({
      subject,
      source: 'reserve-app-backend-action',
      contactRole: 'current_billing_actor',
    }),
    {
      idempotencyKey: `reserve-action-sync:${organizationId}:${attempt.id}`,
    },
  );
  return billingSubject;
};

const createBillingApiHandoffResult = async ({
  ctx,
  identity,
  organizationId,
  role,
  client,
  attempt,
  purpose,
  request,
  now,
  failureMessage,
  callHandoff,
}: {
  ctx: BillingRouteContext;
  identity: BillingIdentity;
  organizationId: string;
  role: 'owner';
  client: BillingApiActionClient;
  attempt: OrganizationBillingOperationAttempt;
  purpose: Extract<
    OrganizationBillingOperationPurpose,
    'paid_checkout' | 'payment_method_setup' | 'billing_portal'
  >;
  request: BillingApiHandoffRequest;
  now: Date;
  failureMessage: string;
  callHandoff(input: {
    subject: Awaited<ReturnType<typeof syncBillingApiActionSubject>>;
    request: BillingApiHandoffRequest;
  }): Promise<BillingApiHandoffResponse>;
}): Promise<JsonRouteResult> => {
  try {
    const subject = await syncBillingApiActionSubject({
      client,
      ctx,
      identity,
      organizationId,
      attempt,
    });
    const handoff = await callHandoff({ subject, request });
    if (handoff.status === 'conflict') {
      const failedAttempt = await ctx.operationStore.markFailed({
        attemptId: attempt.id,
        state: 'conflict',
        failureReason: handoff.message,
      });
      return jsonResult(
        await buildActionEnvelope(ctx, {
          organizationId,
          role,
          status: 'conflict',
          message: handoff.message,
          handoffAttempt: failedAttempt,
          handoffPurpose: purpose,
          handoffReused: handoff.reused,
        }),
        409,
      );
    }
    if (handoff.status === 'failed') {
      const failedAttempt = await ctx.operationStore.markFailed({
        attemptId: attempt.id,
        state: 'failed',
        failureReason: handoff.message,
      });
      return jsonResult(
        await buildActionEnvelope(ctx, {
          organizationId,
          role,
          status: 'failed',
          message: handoff.message,
          handoffAttempt: failedAttempt,
          handoffPurpose: purpose,
          handoffReused: handoff.reused,
        }),
        500,
      );
    }
    if (!handoff.url) {
      throw new Error('Billing API handoff did not return a URL.');
    }

    const succeededAttempt = await ctx.operationStore.markSucceeded({
      attemptId: attempt.id,
      handoffUrl: handoff.url,
      handoffExpiresAt: new Date(now.getTime() + BILLING_HANDOFF_REUSE_WINDOW_MS),
    });
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: handoff.status === 'succeeded' ? 'succeeded' : 'processing',
        message: handoff.message,
        handoffAttempt: succeededAttempt,
        handoffPurpose: purpose,
        handoffReused: handoff.reused,
      }),
      200,
    );
  } catch (error) {
    const failure = toBillingApiActionFailure(error, failureMessage);
    await ctx.operationStore.markFailed({
      attemptId: attempt.id,
      state: failure.attemptState,
      failureReason: failure.message,
    });
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: failure.actionStatus,
        message: failure.message,
      }),
      failure.statusCode,
    );
  }
};

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
  const billingApiActionClient = resolveBillingApiActionClient({ env: ctx.env });
  if (!billingApiActionClient.enabled) {
    return billingApiActionUnavailableResult({
      ctx,
      organizationId,
      role,
      disabledReason: billingApiActionClient.disabledReason,
    });
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
  return createBillingApiHandoffResult({
    ctx,
    identity,
    organizationId,
    role,
    client: billingApiActionClient.client,
    attempt: operation.attempt,
    purpose: 'paid_checkout',
    request: {
      actor: {
        type: 'user',
        id: identity.userId,
        email: identity.email,
      },
      planCode: 'premium',
      interval: body.billingInterval,
      returnUrlKey: 'default',
    },
    now,
    failureMessage: 'Billing API checkout handoff failed.',
    callHandoff: ({ subject, request }) =>
      billingApiActionClient.client.createCheckoutSession(subject, request, {
        idempotencyKey: operation.attempt.idempotencyKey,
      }),
  });
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
        message: RESERVE_APP_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE,
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
        message: RESERVE_APP_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE,
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
        trialDays: RESERVE_APP_PREMIUM_TRIAL_DURATION_DAYS,
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
        message: `Started a ${RESERVE_APP_PREMIUM_TRIAL_DURATION_DAYS}-day premium trial.`,
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
  const billingApiActionClient = resolveBillingApiActionClient({ env: ctx.env });

  if (!billingApiActionClient.enabled) {
    return billingApiActionUnavailableResult({
      ctx,
      organizationId,
      role,
      disabledReason: billingApiActionClient.disabledReason,
    });
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
  return createBillingApiHandoffResult({
    ctx,
    identity,
    organizationId,
    role,
    client: billingApiActionClient.client,
    attempt: operation.attempt,
    purpose: 'payment_method_setup',
    request: {
      actor: {
        type: 'user',
        id: identity.userId,
        email: identity.email,
      },
      planCode: 'premium',
      interval: billing.billingInterval === 'year' ? 'year' : 'month',
      returnUrlKey: 'default',
    },
    now,
    failureMessage: 'Billing API payment method setup handoff failed.',
    callHandoff: ({ subject, request }) =>
      billingApiActionClient.client.createPaymentMethodSetupSession(subject, request, {
        idempotencyKey: operation.attempt.idempotencyKey,
      }),
  });
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
  const billingApiActionClient = resolveBillingApiActionClient({ env: ctx.env });

  if (!billingApiActionClient.enabled) {
    return billingApiActionUnavailableResult({
      ctx,
      organizationId,
      role,
      disabledReason: billingApiActionClient.disabledReason,
    });
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
  return createBillingApiHandoffResult({
    ctx,
    identity,
    organizationId,
    role,
    client: billingApiActionClient.client,
    attempt: operation.attempt,
    purpose: 'billing_portal',
    request: {
      actor: {
        type: 'user',
        id: identity.userId,
        email: identity.email,
      },
      planCode: 'premium',
      interval: billing.billingInterval === 'year' ? 'year' : 'month',
      returnUrlKey: 'default',
    },
    now,
    failureMessage: 'Billing API portal handoff failed.',
    callHandoff: ({ subject, request }) =>
      billingApiActionClient.client.createBillingPortalSession(subject, request, {
        idempotencyKey: operation.attempt.idempotencyKey,
      }),
  });
};
