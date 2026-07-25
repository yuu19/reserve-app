import type {
  BillingApiEntitlementsResponse,
  BillingApiErrorResponse,
  BillingApiAddonItemsResponse,
  BillingApiAddonItemsUpdateRequest,
  BillingApiAddonItemsUpdateResponse,
  BillingApiAdvanceTestClockScenarioRequest,
  BillingApiCreateTestClockScenarioRequest,
  BillingApiHandoffRequest,
  BillingApiHandoffResponse,
  BillingApiInvoiceEventsResponse,
  BillingApiSubjectSyncRequest,
  BillingApiSummaryResponse,
  BillingApiTestClockScenario,
} from '@repo/billing-types';

export type BillingClientOptions = {
  baseUrl: string;
  appId: string;
  apiKey: string;
  fetch?: typeof fetch;
};

export type BillingClientSubjectInput = {
  subjectType: string;
  subjectId: string;
};

export type BillingClientRequestOptions = {
  idempotencyKey?: string;
};

export type BillingClientReadInvoiceEventsOptions = {
  limit?: number;
};

export class BillingClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: BillingApiErrorResponse | unknown,
  ) {
    super(message);
    this.name = 'BillingClientError';
  }
}

const trimBaseUrl = (value: string) => value.replace(/\/+$/, '');

const encodeSegment = (value: string) => encodeURIComponent(value);

export const createBillingClient = ({
  baseUrl,
  appId,
  apiKey,
  fetch: fetchImpl = fetch,
}: BillingClientOptions) => {
  const normalizedBaseUrl = trimBaseUrl(baseUrl);
  const subjectPath = ({ subjectType, subjectId }: BillingClientSubjectInput) =>
    `/api/v1/apps/${encodeSegment(appId)}/subjects/${encodeSegment(subjectType)}/${encodeSegment(
      subjectId,
    )}`;
  const testSubjectPath = ({ subjectType, subjectId }: BillingClientSubjectInput) =>
    `/api/v1/test/apps/${encodeSegment(appId)}/subjects/${encodeSegment(
      subjectType,
    )}/${encodeSegment(subjectId)}`;

  const request = async <TResponse>({
    method,
    path,
    body,
    idempotencyKey,
  }: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH';
    path: string;
    body?: unknown;
    idempotencyKey?: string;
  }): Promise<TResponse> => {
    const headers = new Headers({
      authorization: `Bearer ${apiKey}`,
    });
    if (body !== undefined) {
      headers.set('content-type', 'application/json');
    }
    if (idempotencyKey) {
      headers.set('idempotency-key', idempotencyKey);
    }

    const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      const message =
        typeof parsed === 'object' &&
        parsed !== null &&
        'error' in parsed &&
        typeof (parsed as BillingApiErrorResponse).error?.message === 'string'
          ? (parsed as BillingApiErrorResponse).error.message
          : `Billing API request failed with status ${response.status}.`;
      throw new BillingClientError(message, response.status, parsed);
    }
    return parsed as TResponse;
  };

  return {
    syncSubject(
      subject: BillingClientSubjectInput,
      body: BillingApiSubjectSyncRequest,
      options: BillingClientRequestOptions,
    ) {
      return request<BillingApiSummaryResponse>({
        method: 'PUT',
        path: subjectPath(subject),
        body,
        idempotencyKey: options.idempotencyKey,
      });
    },

    readSummary(subject: BillingClientSubjectInput) {
      return request<BillingApiSummaryResponse>({
        method: 'GET',
        path: `${subjectPath(subject)}/summary`,
      });
    },

    readEntitlements(subject: BillingClientSubjectInput) {
      return request<BillingApiEntitlementsResponse>({
        method: 'GET',
        path: `${subjectPath(subject)}/entitlements`,
      });
    },

    readInvoiceEvents(
      subject: BillingClientSubjectInput,
      options: BillingClientReadInvoiceEventsOptions = {},
    ) {
      const searchParams = new URLSearchParams();
      if (options.limit !== undefined) {
        searchParams.set('limit', String(options.limit));
      }
      return request<BillingApiInvoiceEventsResponse>({
        method: 'GET',
        path: `${subjectPath(subject)}/invoice-events${
          searchParams.size > 0 ? `?${searchParams.toString()}` : ''
        }`,
      });
    },

    startTrial(
      subject: BillingClientSubjectInput,
      body: BillingApiHandoffRequest,
      options: BillingClientRequestOptions,
    ) {
      return request<BillingApiHandoffResponse>({
        method: 'POST',
        path: `${subjectPath(subject)}/trial`,
        body,
        idempotencyKey: options.idempotencyKey,
      });
    },

    createCheckoutSession(
      subject: BillingClientSubjectInput,
      body: BillingApiHandoffRequest,
      options: BillingClientRequestOptions,
    ) {
      return request<BillingApiHandoffResponse>({
        method: 'POST',
        path: `${subjectPath(subject)}/checkout-sessions`,
        body,
        idempotencyKey: options.idempotencyKey,
      });
    },

    createPaymentMethodSetupSession(
      subject: BillingClientSubjectInput,
      body: BillingApiHandoffRequest,
      options: BillingClientRequestOptions,
    ) {
      return request<BillingApiHandoffResponse>({
        method: 'POST',
        path: `${subjectPath(subject)}/payment-method-setup-sessions`,
        body,
        idempotencyKey: options.idempotencyKey,
      });
    },

    createBillingPortalSession(
      subject: BillingClientSubjectInput,
      body: BillingApiHandoffRequest,
      options: BillingClientRequestOptions,
    ) {
      return request<BillingApiHandoffResponse>({
        method: 'POST',
        path: `${subjectPath(subject)}/billing-portal-sessions`,
        body,
        idempotencyKey: options.idempotencyKey,
      });
    },

    readAddonItems(subject: BillingClientSubjectInput) {
      return request<BillingApiAddonItemsResponse>({
        method: 'GET',
        path: `${subjectPath(subject)}/addon-items`,
      });
    },

    updateAddonItems(
      subject: BillingClientSubjectInput,
      body: BillingApiAddonItemsUpdateRequest,
      options: BillingClientRequestOptions,
    ) {
      return request<BillingApiAddonItemsUpdateResponse>({
        method: 'PATCH',
        path: `${subjectPath(subject)}/addon-items`,
        body,
        idempotencyKey: options.idempotencyKey,
      });
    },

    completeTrial(
      subject: BillingClientSubjectInput,
      body: BillingApiHandoffRequest,
      options: BillingClientRequestOptions,
    ) {
      return request<BillingApiHandoffResponse>({
        method: 'POST',
        path: `${subjectPath(subject)}/trial/complete`,
        body,
        idempotencyKey: options.idempotencyKey,
      });
    },

    createTestClockScenario(
      subject: BillingClientSubjectInput,
      body: BillingApiCreateTestClockScenarioRequest,
      options: BillingClientRequestOptions,
    ) {
      return request<BillingApiTestClockScenario>({
        method: 'POST',
        path: `${testSubjectPath(subject)}/clock-scenarios`,
        body,
        idempotencyKey: options.idempotencyKey,
      });
    },

    advanceTestClockScenario(
      subject: BillingClientSubjectInput,
      scenarioId: string,
      body: BillingApiAdvanceTestClockScenarioRequest,
      options: BillingClientRequestOptions,
    ) {
      return request<BillingApiTestClockScenario>({
        method: 'POST',
        path: `${testSubjectPath(subject)}/clock-scenarios/${encodeSegment(scenarioId)}/advance`,
        body,
        idempotencyKey: options.idempotencyKey,
      });
    },

    readTestClockScenario(subject: BillingClientSubjectInput, scenarioId: string) {
      return request<BillingApiTestClockScenario>({
        method: 'GET',
        path: `${testSubjectPath(subject)}/clock-scenarios/${encodeSegment(scenarioId)}`,
      });
    },
  };
};
