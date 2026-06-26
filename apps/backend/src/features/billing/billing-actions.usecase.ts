import { BillingClientError } from '@repo/billing-client';
import type { BillingClientSubjectInput } from '@repo/billing-client';
import type {
  BillingApiHandoffRequest,
  BillingApiHandoffResponse,
  BillingApiSummaryResponse,
} from '@repo/billing-types';
import {
  BILLING_HANDOFF_REUSE_WINDOW_MS,
  type OrganizationBillingOperationAttempt,
  type OrganizationBillingOperationPurpose,
} from '../../domain/billing/organization-billing-operations.js';
import { RESERVE_APP_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE } from './policies/reserve-app-billing-policy.js';
import {
  forbidden,
  jsonResult,
  unauthorized,
  validationError,
  type JsonRouteResult,
} from '../../shared/route-result.js';
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

const readBillingApiActionSubscriptionStatus = (summary: BillingApiSummaryResponse) =>
  summary.entitlements.status ?? summary.subscription?.status ?? 'free';

const isBillingApiPremiumPlan = (summary: BillingApiSummaryResponse) =>
  summary.entitlements.planCode === 'premium' || summary.subscription?.planCode === 'premium';

const isBillingApiActivePremiumLifecycle = (summary: BillingApiSummaryResponse) =>
  isBillingApiPremiumPlan(summary) &&
  isActivePremiumSubscriptionStatus(readBillingApiActionSubscriptionStatus(summary));

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
  idempotencyKeySuffix,
}: {
  client: Pick<BillingApiActionClient, 'syncSubject'>;
  ctx: BillingRouteContext;
  identity: BillingIdentity;
  organizationId: string;
  idempotencyKeySuffix: string;
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
      idempotencyKey: `reserve-action-sync:${organizationId}:${idempotencyKeySuffix}`,
    },
  );
  return {
    organizationSubject: subject,
    billingSubject,
  };
};

type SyncedBillingApiActionSubject = Awaited<ReturnType<typeof syncBillingApiActionSubject>>;

const readOptionalBillingApiActionSummary = async ({
  client,
  subject,
}: {
  client: Pick<BillingApiActionClient, 'readSummary'>;
  subject: BillingClientSubjectInput | SyncedBillingApiActionSubject;
}): Promise<BillingApiSummaryResponse | null> => {
  try {
    return await client.readSummary('billingSubject' in subject ? subject.billingSubject : subject);
  } catch {
    return null;
  }
};

const readRequiredBillingApiActionSummary = async ({
  ctx,
  identity,
  organizationId,
  role,
  client,
  idempotencyKeySuffix,
}: {
  ctx: BillingRouteContext;
  identity: BillingIdentity;
  organizationId: string;
  role: 'owner';
  client: BillingApiActionClient;
  idempotencyKeySuffix: string;
}): Promise<
  | {
      ok: true;
      subject: SyncedBillingApiActionSubject;
      summary: BillingApiSummaryResponse;
    }
  | {
      ok: false;
      result: JsonRouteResult;
    }
> => {
  try {
    const subject = await syncBillingApiActionSubject({
      client,
      ctx,
      identity,
      organizationId,
      idempotencyKeySuffix,
    });
    const summary = await client.readSummary(subject.billingSubject);
    return {
      ok: true,
      subject,
      summary,
    };
  } catch (error) {
    return {
      ok: false,
      result: jsonResult(
        await buildActionEnvelope(ctx, {
          organizationId,
          role,
          status: 'failed',
          message: toBillingOperationFailureMessage(error, 'Billing API summary is unavailable.'),
        }),
        503,
      ),
    };
  }
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
  syncedSubject,
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
    subject: BillingClientSubjectInput;
    request: BillingApiHandoffRequest;
  }): Promise<BillingApiHandoffResponse>;
  syncedSubject?: SyncedBillingApiActionSubject;
}): Promise<JsonRouteResult> => {
  let subjectForSummary: SyncedBillingApiActionSubject | null = null;
  try {
    const subject =
      syncedSubject ??
      (await syncBillingApiActionSubject({
        client,
        ctx,
        identity,
        organizationId,
        idempotencyKeySuffix: attempt.id,
      }));
    subjectForSummary = subject;
    const handoff = await callHandoff({ subject: subject.billingSubject, request });
    const billingApiSummaryResponse = await readOptionalBillingApiActionSummary({
      client,
      subject,
    });
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
          billingApiSummaryResponse,
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
          billingApiSummaryResponse,
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
        billingApiSummaryResponse,
      }),
      200,
    );
  } catch (error) {
    const billingApiSummaryResponse = subjectForSummary
      ? await readOptionalBillingApiActionSummary({ client, subject: subjectForSummary })
      : null;
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
        billingApiSummaryResponse,
      }),
      failure.statusCode,
    );
  }
};

const createBillingApiLifecycleActionResult = async ({
  ctx,
  identity,
  organizationId,
  role,
  client,
  attempt,
  request,
  successStatus = 200,
  failureMessage,
  callAction,
  syncedSubject,
}: {
  ctx: BillingRouteContext;
  identity: BillingIdentity;
  organizationId: string;
  role: 'owner';
  client: BillingApiActionClient;
  attempt: OrganizationBillingOperationAttempt | null;
  request: BillingApiHandoffRequest;
  successStatus?: 200;
  failureMessage: string;
  callAction(input: {
    subject: BillingClientSubjectInput;
    request: BillingApiHandoffRequest;
  }): Promise<BillingApiHandoffResponse>;
  syncedSubject?: SyncedBillingApiActionSubject;
}): Promise<JsonRouteResult> => {
  let subjectForSummary: SyncedBillingApiActionSubject | null = null;
  try {
    const subject =
      syncedSubject ??
      (await syncBillingApiActionSubject({
        client,
        ctx,
        identity,
        organizationId,
        idempotencyKeySuffix: attempt?.id ?? `manual:${organizationId}:${identity.userId}`,
      }));
    subjectForSummary = subject;
    const action = await callAction({ subject: subject.billingSubject, request });
    const billingApiSummaryResponse = await readOptionalBillingApiActionSummary({
      client,
      subject,
    });
    if (action.status === 'conflict') {
      const failedAttempt = attempt
        ? await ctx.operationStore.markFailed({
            attemptId: attempt.id,
            state: 'conflict',
            failureReason: action.message,
          })
        : null;
      return jsonResult(
        await buildActionEnvelope(ctx, {
          organizationId,
          role,
          status: 'conflict',
          message: action.message,
          handoffAttempt: failedAttempt,
          handoffPurpose: attempt?.purpose,
          handoffReused: action.reused,
          billingApiSummaryResponse,
        }),
        409,
      );
    }
    if (action.status === 'failed') {
      const failedAttempt = attempt
        ? await ctx.operationStore.markFailed({
            attemptId: attempt.id,
            state: 'failed',
            failureReason: action.message,
          })
        : null;
      return jsonResult(
        await buildActionEnvelope(ctx, {
          organizationId,
          role,
          status: 'failed',
          message: action.message,
          handoffAttempt: failedAttempt,
          handoffPurpose: attempt?.purpose,
          handoffReused: action.reused,
          billingApiSummaryResponse,
        }),
        500,
      );
    }

    const succeededAttempt = attempt
      ? await ctx.operationStore.markSucceeded({
          attemptId: attempt.id,
        })
      : null;
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: action.status === 'processing' ? 'processing' : 'succeeded',
        message: action.message,
        handoffAttempt: succeededAttempt,
        handoffPurpose: attempt?.purpose,
        handoffReused: action.reused,
        billingApiSummaryResponse,
      }),
      successStatus,
    );
  } catch (error) {
    const billingApiSummaryResponse = subjectForSummary
      ? await readOptionalBillingApiActionSummary({ client, subject: subjectForSummary })
      : null;
    const failure = toBillingApiActionFailure(error, failureMessage);
    if (attempt) {
      await ctx.operationStore.markFailed({
        attemptId: attempt.id,
        state: failure.attemptState,
        failureReason: failure.message,
      });
    }
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: failure.actionStatus,
        message: failure.message,
        billingApiSummaryResponse,
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

  const billingApiSummary = await readRequiredBillingApiActionSummary({
    ctx,
    identity,
    organizationId,
    role,
    client: billingApiActionClient.client,
    idempotencyKeySuffix: 'paid-checkout-precondition',
  });
  if (!billingApiSummary.ok) {
    return billingApiSummary.result;
  }
  if (isBillingApiActivePremiumLifecycle(billingApiSummary.summary)) {
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'conflict',
        message: 'Organization already has an active premium subscription.',
        billingApiSummaryResponse: billingApiSummary.summary,
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
    syncedSubject: billingApiSummary.subject,
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
  const billingApiActionClient = resolveBillingApiActionClient({ env: ctx.env });
  if (!billingApiActionClient.enabled) {
    return billingApiActionUnavailableResult({
      ctx,
      organizationId,
      role,
      disabledReason: billingApiActionClient.disabledReason,
    });
  }

  const billingApiSummary = await readRequiredBillingApiActionSummary({
    ctx,
    identity,
    organizationId,
    role,
    client: billingApiActionClient.client,
    idempotencyKeySuffix: 'trial-start-precondition',
  });
  if (!billingApiSummary.ok) {
    return billingApiSummary.result;
  }
  if (isBillingApiActivePremiumLifecycle(billingApiSummary.summary)) {
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'conflict',
        message: RESERVE_APP_PREMIUM_LIFECYCLE_CONFLICT_MESSAGE,
        billingApiSummaryResponse: billingApiSummary.summary,
      }),
      409,
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
  return createBillingApiLifecycleActionResult({
    ctx,
    identity,
    organizationId,
    role,
    client: billingApiActionClient.client,
    attempt: operation.attempt,
    request: {
      actor: {
        type: 'user',
        id: identity.userId,
        email: identity.email,
      },
      planCode: 'premium',
      returnUrlKey: 'default',
    },
    failureMessage: 'Billing API trial start failed.',
    callAction: ({ subject, request }) =>
      billingApiActionClient.client.startTrial(subject, request, {
        idempotencyKey: operation.attempt.idempotencyKey,
      }),
    syncedSubject: billingApiSummary.subject,
  });
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

  const billingApiSummary = await readRequiredBillingApiActionSummary({
    ctx,
    identity,
    organizationId,
    role,
    client: billingApiActionClient.client,
    idempotencyKeySuffix: 'payment-method-setup-precondition',
  });
  if (!billingApiSummary.ok) {
    return billingApiSummary.result;
  }
  const billingApiStatus = readBillingApiActionSubscriptionStatus(billingApiSummary.summary);
  if (!isBillingApiPremiumPlan(billingApiSummary.summary) || billingApiStatus !== 'trialing') {
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'conflict',
        message: 'Organization does not have an active premium trial.',
        billingApiSummaryResponse: billingApiSummary.summary,
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
      interval: billingApiSummary.summary.subscription?.interval === 'year' ? 'year' : 'month',
      returnUrlKey: 'default',
    },
    now,
    failureMessage: 'Billing API payment method setup handoff failed.',
    callHandoff: ({ subject, request }) =>
      billingApiActionClient.client.createPaymentMethodSetupSession(subject, request, {
        idempotencyKey: operation.attempt.idempotencyKey,
      }),
    syncedSubject: billingApiSummary.subject,
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

  const billingApiSummary = await readRequiredBillingApiActionSummary({
    ctx,
    identity,
    organizationId,
    role,
    client: billingApiActionClient.client,
    idempotencyKeySuffix: 'trial-complete-precondition',
  });
  if (!billingApiSummary.ok) {
    return billingApiSummary.result;
  }
  const billingApiStatus = readBillingApiActionSubscriptionStatus(billingApiSummary.summary);
  if (!isBillingApiPremiumPlan(billingApiSummary.summary) || billingApiStatus !== 'trialing') {
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'conflict',
        message: 'Organization does not have an active premium trial.',
        billingApiSummaryResponse: billingApiSummary.summary,
      }),
      409,
    );
  }

  return createBillingApiLifecycleActionResult({
    ctx,
    identity,
    organizationId,
    role,
    client: billingApiActionClient.client,
    attempt: null,
    request: {
      actor: {
        type: 'user',
        id: identity.userId,
        email: identity.email,
      },
      planCode: 'premium',
      returnUrlKey: 'default',
    },
    failureMessage: 'Billing API trial completion failed.',
    callAction: ({ subject, request }) =>
      billingApiActionClient.client.completeTrial(subject, request, {
        idempotencyKey: `reserve-trial-complete:${organizationId}:${identity.userId}`,
      }),
    syncedSubject: billingApiSummary.subject,
  });
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

  const billingApiSummary = await readRequiredBillingApiActionSummary({
    ctx,
    identity,
    organizationId,
    role,
    client: billingApiActionClient.client,
    idempotencyKeySuffix: 'billing-portal-precondition',
  });
  if (!billingApiSummary.ok) {
    return billingApiSummary.result;
  }
  if (
    !billingApiSummary.summary.account.providerCustomerId ||
    !billingApiSummary.summary.subscription?.providerSubscriptionId ||
    !isBillingApiActivePremiumLifecycle(billingApiSummary.summary)
  ) {
    return jsonResult(
      await buildActionEnvelope(ctx, {
        organizationId,
        role,
        status: 'conflict',
        message:
          'Billing portal is unavailable for free, canceled, or no-provider-subscription state.',
        billingApiSummaryResponse: billingApiSummary.summary,
      }),
      409,
    );
  }

  const now = new Date();
  const operation = await ctx.operationStore.createAttempt({
    organizationId,
    purpose: 'billing_portal',
    stripeSubscriptionId: billingApiSummary.summary.subscription.providerSubscriptionId,
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
      interval: billingApiSummary.summary.subscription?.interval === 'year' ? 'year' : 'month',
      returnUrlKey: 'default',
    },
    now,
    failureMessage: 'Billing API portal handoff failed.',
    callHandoff: ({ subject, request }) =>
      billingApiActionClient.client.createBillingPortalSession(subject, request, {
        idempotencyKey: operation.attempt.idempotencyKey,
      }),
    syncedSubject: billingApiSummary.subject,
  });
};
