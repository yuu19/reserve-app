import { BillingClientError } from '@repo/billing-client';
import type { BillingClientSubjectInput } from '@repo/billing-client';
import type {
  BillingApiAdvanceTestClockScenarioRequest,
  BillingApiCreateTestClockScenarioRequest,
} from '@repo/billing-types';
import {
  canAccessInternalBillingInspection,
  INTERNAL_BILLING_INSPECTION_DENIED_MESSAGE,
} from '../../domain/billing/internal-operator-access.js';
import {
  jsonResult,
  notFound,
  unauthorized,
  type JsonRouteResult,
  type JsonStatus,
} from '../../shared/route-result.js';
import {
  buildBillingApiOrganizationSubjectSyncRequest,
  resolveBillingApiTestClockClient,
  sha256Hex,
  toBillingApiOrganizationSubjectInput,
  type BillingApiClientDisabledReason,
  type BillingApiTestClockClient,
  type BillingApiOrganizationSubject,
} from './billing-api-client.js';
import type { BillingIdentity, BillingRouteContext } from './billing.route-context.js';
import type {
  InternalBillingTestClockScenarioAdvanceBody,
  InternalBillingTestClockScenarioCreateBody,
  InternalBillingTestClockScenarioParams,
  InternalBillingTestClockScenarioWithIdParams,
} from './billing.schemas.js';

type InternalTestClockContext =
  | {
      ok: true;
      identity: BillingIdentity;
      client: BillingApiTestClockClient;
      billingSubject: BillingClientSubjectInput;
      organizationSubject: BillingApiOrganizationSubject;
    }
  | {
      ok: false;
      result: JsonRouteResult;
    };

const toTestClockDisabledMessage = (reason: BillingApiClientDisabledReason): string => {
  if (reason === 'missing_base_url' || reason === 'missing_api_key') {
    return 'Billing API Test Clock proxy is not configured.';
  }
  return 'Billing API Test Clock proxy is disabled.';
};

const toProxyFailureResult = (
  error: unknown,
  fallbackMessage: string,
): JsonRouteResult<{ message: string }> => {
  if (error instanceof BillingClientError) {
    const safeStatuses = new Set<JsonStatus>([400, 404, 409, 422]);
    if (safeStatuses.has(error.status as JsonStatus)) {
      return jsonResult({ message: error.message }, error.status as JsonStatus);
    }
    return jsonResult({ message: fallbackMessage }, 503);
  }

  return jsonResult({ message: fallbackMessage }, 503);
};

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
  return `{${entries.join(',')}}`;
};

const bodyHash = async (body: unknown): Promise<string> =>
  (await sha256Hex(stableJson(body))).slice(0, 24);

const buildActor = (identity: BillingIdentity) => ({
  type: 'user' as const,
  id: identity.userId,
  email: identity.email,
});

const resolveInternalTestClockContext = async ({
  ctx,
  organizationId,
  headers,
}: {
  ctx: BillingRouteContext;
  organizationId: string;
  headers: Headers;
}): Promise<InternalTestClockContext> => {
  const identity = await ctx.getSessionIdentity(headers);
  if (!identity) {
    return {
      ok: false,
      result: unauthorized(),
    };
  }

  if (
    !canAccessInternalBillingInspection({
      env: ctx.env,
      email: identity.email,
      emailVerified: identity.emailVerified,
    })
  ) {
    return {
      ok: false,
      result: jsonResult({ message: INTERNAL_BILLING_INSPECTION_DENIED_MESSAGE }, 403),
    };
  }

  const localOrganization = await ctx.readOrganizationSubject({ organizationId });
  if (!localOrganization) {
    return {
      ok: false,
      result: notFound('Organization not found.'),
    };
  }

  const clientResolution = resolveBillingApiTestClockClient({ env: ctx.env });
  if (!clientResolution.enabled) {
    return {
      ok: false,
      result: jsonResult(
        { message: toTestClockDisabledMessage(clientResolution.disabledReason) },
        422,
      ),
    };
  }

  const organizationSubject = {
    organizationId,
    organizationName: localOrganization.name,
    organizationSlug: localOrganization.slug,
    billingEmail: identity.email,
  };

  return {
    ok: true,
    identity,
    client: clientResolution.client,
    billingSubject: toBillingApiOrganizationSubjectInput(organizationSubject),
    organizationSubject,
  };
};

export const createInternalBillingTestClockScenario = async ({
  ctx,
  params,
  body,
  headers,
}: {
  ctx: BillingRouteContext;
  params: InternalBillingTestClockScenarioParams;
  body: InternalBillingTestClockScenarioCreateBody;
  headers: Headers;
}): Promise<JsonRouteResult> => {
  const resolved = await resolveInternalTestClockContext({
    ctx,
    organizationId: params.organizationId,
    headers,
  });
  if (!resolved.ok) {
    return resolved.result;
  }

  const hash = await bodyHash(body);
  const requestBody = {
    ...body,
    actor: buildActor(resolved.identity),
  } satisfies BillingApiCreateTestClockScenarioRequest;

  try {
    await resolved.client.syncSubject(
      resolved.billingSubject,
      buildBillingApiOrganizationSubjectSyncRequest({
        subject: resolved.organizationSubject,
        source: 'reserve-app-backend-test-clock',
        contactRole: 'internal_test_clock_actor',
      }),
      {
        idempotencyKey: `reserve-test-clock-sync:${params.organizationId}:${hash}`,
      },
    );

    const scenario = await resolved.client.createTestClockScenario(
      resolved.billingSubject,
      requestBody,
      {
        idempotencyKey: `reserve-test-clock-create:${params.organizationId}:${body.scenarioType}:${hash}`,
      },
    );
    return jsonResult(scenario, 200);
  } catch (error) {
    return toProxyFailureResult(error, 'Billing API Test Clock scenario creation is unavailable.');
  }
};

export const readInternalBillingTestClockScenario = async ({
  ctx,
  params,
  headers,
}: {
  ctx: BillingRouteContext;
  params: InternalBillingTestClockScenarioWithIdParams;
  headers: Headers;
}): Promise<JsonRouteResult> => {
  const resolved = await resolveInternalTestClockContext({
    ctx,
    organizationId: params.organizationId,
    headers,
  });
  if (!resolved.ok) {
    return resolved.result;
  }

  try {
    const scenario = await resolved.client.readTestClockScenario(
      resolved.billingSubject,
      params.scenarioId,
    );
    return jsonResult(scenario, 200);
  } catch (error) {
    return toProxyFailureResult(error, 'Billing API Test Clock scenario read is unavailable.');
  }
};

export const advanceInternalBillingTestClockScenario = async ({
  ctx,
  params,
  body,
  headers,
}: {
  ctx: BillingRouteContext;
  params: InternalBillingTestClockScenarioWithIdParams;
  body: InternalBillingTestClockScenarioAdvanceBody;
  headers: Headers;
}): Promise<JsonRouteResult> => {
  const resolved = await resolveInternalTestClockContext({
    ctx,
    organizationId: params.organizationId,
    headers,
  });
  if (!resolved.ok) {
    return resolved.result;
  }

  const hash = await bodyHash(body);
  const requestBody = body satisfies BillingApiAdvanceTestClockScenarioRequest;

  try {
    const scenario = await resolved.client.advanceTestClockScenario(
      resolved.billingSubject,
      params.scenarioId,
      requestBody,
      {
        idempotencyKey: `reserve-test-clock-advance:${params.organizationId}:${params.scenarioId}:${hash}`,
      },
    );
    return jsonResult(scenario, 200);
  } catch (error) {
    return toProxyFailureResult(error, 'Billing API Test Clock scenario advance is unavailable.');
  }
};
