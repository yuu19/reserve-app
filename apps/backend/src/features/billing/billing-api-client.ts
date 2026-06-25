import { createBillingClient } from '@repo/billing-client';
import type { BillingClientRequestOptions, BillingClientSubjectInput } from '@repo/billing-client';
import type { BillingApiSubjectSyncRequest } from '@repo/billing-types';
import type { AuthRuntimeEnv } from '../../auth-runtime.js';

export type BillingApiClient = ReturnType<typeof createBillingClient>;

export type BillingApiClientDisabledReason =
  | 'disabled_by_flag'
  | 'missing_base_url'
  | 'missing_api_key';

export type BillingApiClientResolution<TClient = BillingApiClient> =
  | {
      enabled: true;
      client: TClient;
    }
  | {
      enabled: false;
      disabledReason: BillingApiClientDisabledReason;
    };

export type BillingApiOrganizationSubject = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  billingEmail?: string | null;
};

export type BillingApiActionClient = Pick<
  BillingApiClient,
  | 'syncSubject'
  | 'startTrial'
  | 'createCheckoutSession'
  | 'createPaymentMethodSetupSession'
  | 'createBillingPortalSession'
  | 'completeTrial'
>;

export type BillingApiActionClientResolution = BillingApiClientResolution<BillingApiActionClient>;

export type BillingApiSummaryClient = Pick<BillingApiClient, 'syncSubject' | 'readSummary'>;

export type BillingApiSummaryClientResolution = BillingApiClientResolution<BillingApiSummaryClient>;

export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const toBillingApiOrganizationSubjectInput = ({
  organizationId,
}: BillingApiOrganizationSubject): BillingClientSubjectInput => ({
  subjectType: 'organization',
  subjectId: organizationId,
});

export const buildBillingApiOrganizationSubjectSyncRequest = ({
  subject,
  source,
  contactRole,
}: {
  subject: BillingApiOrganizationSubject;
  source:
    | 'reserve-app-backend-shadow'
    | 'reserve-app-backend-action'
    | 'reserve-app-backend-summary';
  contactRole: string;
}): BillingApiSubjectSyncRequest => ({
  displayName: subject.organizationName,
  billingEmail: subject.billingEmail ?? null,
  billingName: subject.organizationName,
  billingContacts: subject.billingEmail
    ? [
        {
          email: subject.billingEmail,
          name: subject.organizationName,
          role: contactRole,
        },
      ]
    : [],
  metadata: {
    source,
    organizationSlug: subject.organizationSlug,
  },
});

export const resolveBillingApiClient = ({
  env,
  enabled,
  fetch: fetchImpl,
}: {
  env: AuthRuntimeEnv;
  enabled: boolean;
  fetch?: typeof fetch;
}): BillingApiClientResolution => {
  if (!enabled) {
    return { enabled: false, disabledReason: 'disabled_by_flag' };
  }

  const baseUrl = env.BILLING_API_BASE_URL?.trim();
  if (!baseUrl) {
    return { enabled: false, disabledReason: 'missing_base_url' };
  }

  const apiKey = env.BILLING_API_KEY?.trim();
  if (!apiKey) {
    return { enabled: false, disabledReason: 'missing_api_key' };
  }

  return {
    enabled: true,
    client: createBillingClient({
      baseUrl,
      appId: 'reserve',
      apiKey,
      fetch: fetchImpl,
    }),
  };
};

export const resolveBillingApiActionClient = ({
  env,
  fetch: fetchImpl,
}: {
  env: AuthRuntimeEnv;
  fetch?: typeof fetch;
}): BillingApiActionClientResolution => {
  const resolution = resolveBillingApiClient({
    env,
    enabled: env.BILLING_API_ACTIONS_ENABLED === 'true',
    fetch: fetchImpl,
  });

  return resolution;
};

export const resolveBillingApiSummaryClient = ({
  env,
  fetch: fetchImpl,
}: {
  env: AuthRuntimeEnv;
  fetch?: typeof fetch;
}): BillingApiSummaryClientResolution => {
  const resolution = resolveBillingApiClient({
    env,
    enabled: env.BILLING_API_SUMMARY_ENABLED === 'true',
    fetch: fetchImpl,
  });

  return resolution;
};

export type BillingApiSubjectSyncClient = {
  syncSubject(
    subject: BillingClientSubjectInput,
    body: BillingApiSubjectSyncRequest,
    options: BillingClientRequestOptions,
  ): Promise<unknown>;
};
