import type { BillingClientRequestOptions } from '@repo/billing-client';
import { createBillingClient } from '@repo/billing-client';
import type {
  BillingApiEntitlementsResponse,
  BillingApiPriceResolution,
  BillingApiSubscriptionStatus,
} from '@repo/billing-types';
import type { AuthRuntimeEnv } from '../../auth-runtime.js';
import type {
  ReserveAppBillingEntitlementState,
  ReserveAppBillingPaidTierCapability,
} from '../../domain/billing/reserve-app-billing-entitlement-policy.js';
import type {
  ReserveAppBillingPlanCode,
  ReserveAppBillingSubscriptionStatus,
} from './policies/reserve-app-billing-policy.js';

export type BillingApiShadowStatus = 'disabled' | 'matched' | 'mismatch' | 'unavailable';

export type BillingApiShadowDisabledReason =
  | 'disabled_by_flag'
  | 'missing_base_url'
  | 'missing_api_key';

export type BillingApiShadowDifference = {
  field: string;
  legacy: unknown;
  billingApi: unknown;
  reason: string;
};

export type BillingApiShadowLegacySnapshot = {
  planCode: ReserveAppBillingPlanCode;
  subscriptionStatus: ReserveAppBillingSubscriptionStatus;
  entitlementState: ReserveAppBillingEntitlementState;
  premiumEligible: boolean;
  capabilities: ReserveAppBillingPaidTierCapability[];
};

export type BillingApiShadowDiagnostic = {
  status: BillingApiShadowStatus;
  checkedAt: string;
  disabledReason: BillingApiShadowDisabledReason | null;
  unavailableReason: string | null;
  priceResolution: BillingApiPriceResolution | null;
  planCode: string | null;
  subscriptionStatus: BillingApiSubscriptionStatus | null;
  features: Record<string, unknown> | null;
  legacy: BillingApiShadowLegacySnapshot;
  differences: BillingApiShadowDifference[];
};

export type BillingApiShadowSubject = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  billingEmail?: string | null;
};

export type BillingApiShadowClient = {
  syncSubject(
    subject: { subjectType: string; subjectId: string },
    body: {
      displayName: string;
      billingEmail?: string | null;
      billingName?: string | null;
      billingContacts?: Array<{ email: string; name?: string | null; role?: string | null }>;
      metadata?: Record<string, unknown>;
    },
    options: BillingClientRequestOptions,
  ): Promise<unknown>;
  readEntitlements(subject: {
    subjectType: string;
    subjectId: string;
  }): Promise<BillingApiEntitlementsResponse>;
};

export type BillingApiShadowClientResolution =
  | {
      enabled: true;
      client: BillingApiShadowClient;
    }
  | {
      enabled: false;
      disabledReason: BillingApiShadowDisabledReason;
    };

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const toUnavailableReason = (error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return 'billing_api_shadow_unavailable';
};

const hasBillingApiPremiumFeatures = (features: Record<string, unknown>) =>
  Object.keys(features).length > 0;

const buildDisabledDiagnostic = ({
  checkedAt,
  disabledReason,
  legacy,
}: {
  checkedAt: string;
  disabledReason: BillingApiShadowDisabledReason;
  legacy: BillingApiShadowLegacySnapshot;
}): BillingApiShadowDiagnostic => ({
  status: 'disabled',
  checkedAt,
  disabledReason,
  unavailableReason: null,
  priceResolution: null,
  planCode: null,
  subscriptionStatus: null,
  features: null,
  legacy,
  differences: [],
});

const buildUnavailableDiagnostic = ({
  checkedAt,
  error,
  legacy,
}: {
  checkedAt: string;
  error: unknown;
  legacy: BillingApiShadowLegacySnapshot;
}): BillingApiShadowDiagnostic => ({
  status: 'unavailable',
  checkedAt,
  disabledReason: null,
  unavailableReason: toUnavailableReason(error),
  priceResolution: null,
  planCode: null,
  subscriptionStatus: null,
  features: null,
  legacy,
  differences: [],
});

const compareBillingApiShadow = ({
  response,
  legacy,
}: {
  response: BillingApiEntitlementsResponse;
  legacy: BillingApiShadowLegacySnapshot;
}): BillingApiShadowDifference[] => {
  const billingApiPremiumEligible = hasBillingApiPremiumFeatures(response.features);
  const differences: BillingApiShadowDifference[] = [];

  if (response.planCode !== legacy.planCode) {
    differences.push({
      field: 'planCode',
      legacy: legacy.planCode,
      billingApi: response.planCode,
      reason: 'legacy_plan_code_and_billing_api_plan_code_differ',
    });
  }

  if (response.status !== legacy.subscriptionStatus) {
    differences.push({
      field: 'subscriptionStatus',
      legacy: legacy.subscriptionStatus,
      billingApi: response.status,
      reason: 'legacy_subscription_status_and_billing_api_status_differ',
    });
  }

  if (billingApiPremiumEligible !== legacy.premiumEligible) {
    differences.push({
      field: 'premiumEligible',
      legacy: legacy.premiumEligible,
      billingApi: billingApiPremiumEligible,
      reason: 'legacy_premium_eligibility_and_billing_api_features_differ',
    });
  }

  if (response.priceResolution === 'unknown' && legacy.premiumEligible) {
    differences.push({
      field: 'priceResolution',
      legacy: 'known_or_legacy',
      billingApi: response.priceResolution,
      reason: 'billing_api_price_is_unknown_while_legacy_allows_premium',
    });
  }

  return differences;
};

export const resolveBillingApiShadowClient = ({
  env,
  fetch: fetchImpl,
}: {
  env: AuthRuntimeEnv;
  fetch?: typeof fetch;
}): BillingApiShadowClientResolution => {
  if (env.BILLING_API_SHADOW_ENABLED !== 'true') {
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

export const readBillingApiShadowDiagnostic = async ({
  clientResolution,
  subject,
  legacy,
  checkedAt = new Date(),
}: {
  clientResolution: BillingApiShadowClientResolution;
  subject: BillingApiShadowSubject;
  legacy: BillingApiShadowLegacySnapshot;
  checkedAt?: Date;
}): Promise<BillingApiShadowDiagnostic> => {
  const checkedAtIso = checkedAt.toISOString();

  if (!clientResolution.enabled) {
    return buildDisabledDiagnostic({
      checkedAt: checkedAtIso,
      disabledReason: clientResolution.disabledReason,
      legacy,
    });
  }

  const billingSubject = {
    subjectType: 'organization',
    subjectId: subject.organizationId,
  };
  const syncBody = {
    displayName: subject.organizationName,
    billingEmail: subject.billingEmail ?? null,
    billingName: subject.organizationName,
    billingContacts: subject.billingEmail
      ? [
          {
            email: subject.billingEmail,
            name: subject.organizationName,
            role: 'current_billing_viewer',
          },
        ]
      : [],
    metadata: {
      source: 'reserve-app-backend-shadow',
      organizationSlug: subject.organizationSlug,
    },
  };

  try {
    const syncBodyHash = await sha256Hex(JSON.stringify(syncBody));
    await clientResolution.client.syncSubject(billingSubject, syncBody, {
      idempotencyKey: `reserve-shadow-sync:${subject.organizationId}:${syncBodyHash.slice(0, 16)}`,
    });
    const response = await clientResolution.client.readEntitlements(billingSubject);
    const differences = compareBillingApiShadow({ response, legacy });
    return {
      status: differences.length > 0 ? 'mismatch' : 'matched',
      checkedAt: checkedAtIso,
      disabledReason: null,
      unavailableReason: null,
      priceResolution: response.priceResolution,
      planCode: response.planCode,
      subscriptionStatus: response.status,
      features: response.features,
      legacy,
      differences,
    };
  } catch (error) {
    return buildUnavailableDiagnostic({
      checkedAt: checkedAtIso,
      error,
      legacy,
    });
  }
};
