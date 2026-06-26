import { eq } from 'drizzle-orm';
import type { BillingApiSummaryResponse } from '@repo/billing-types';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import * as dbSchema from '../../infra/db/schema.js';
import {
  buildBillingApiOrganizationSubjectSyncRequest,
  resolveBillingApiSummaryClient,
  sha256Hex,
  toBillingApiOrganizationSubjectInput,
  type BillingApiOrganizationSubject,
  type BillingApiSummaryClientResolution,
} from './billing-api-client.js';
import { RESERVE_APP_ENTITLEMENTS } from './policies/reserve-app-entitlements.js';

const premiumEntitlementStatuses = new Set(['active', 'trialing']);

export const hasBillingApiPremiumEntitlement = (summary: BillingApiSummaryResponse): boolean => {
  const premiumFeatureValue =
    summary.entitlements.features[RESERVE_APP_ENTITLEMENTS.ORGANIZATION_PREMIUM];
  if (premiumFeatureValue === true) {
    return true;
  }
  if (premiumFeatureValue === false) {
    return false;
  }

  const hasPremiumPlan =
    summary.subscription?.planCode === 'premium' || summary.entitlements.planCode === 'premium';
  const entitlementStatus = summary.entitlements.status;
  const subscriptionStatus = summary.subscription?.status;
  return (
    hasPremiumPlan &&
    (premiumEntitlementStatuses.has(entitlementStatus) ||
      (subscriptionStatus ? premiumEntitlementStatuses.has(subscriptionStatus) : false))
  );
};

export const readBillingApiFeatureEntitlement = ({
  summary,
  key,
}: {
  summary: BillingApiSummaryResponse;
  key: string;
}): boolean | null => {
  if (key === RESERVE_APP_ENTITLEMENTS.ORGANIZATION_PREMIUM) {
    return hasBillingApiPremiumEntitlement(summary);
  }

  const featureValue = summary.entitlements.features[key];
  if (featureValue === true || featureValue === false) {
    return featureValue;
  }
  return null;
};

export const readBillingApiSummary = async ({
  clientResolution,
  subject,
  contactRole,
  idempotencyKeyPrefix,
}: {
  clientResolution: BillingApiSummaryClientResolution;
  subject: BillingApiOrganizationSubject;
  contactRole: string;
  idempotencyKeyPrefix: string;
}): Promise<BillingApiSummaryResponse | null> => {
  if (!clientResolution.enabled) {
    return null;
  }

  const billingSubject = toBillingApiOrganizationSubjectInput(subject);
  const syncBody = buildBillingApiOrganizationSubjectSyncRequest({
    subject,
    source: 'reserve-app-backend-summary',
    contactRole,
  });
  const syncBodyHash = await sha256Hex(JSON.stringify(syncBody));

  try {
    await clientResolution.client.syncSubject(billingSubject, syncBody, {
      idempotencyKey: `${idempotencyKeyPrefix}:${subject.organizationId}:${syncBodyHash.slice(0, 16)}`,
    });
    return await clientResolution.client.readSummary(billingSubject);
  } catch {
    return null;
  }
};

export const readBillingApiOrganizationFeatureEntitlement = async ({
  database,
  env,
  organizationId,
  key,
  contactRole,
  idempotencyKeyPrefix,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationId: string;
  key: string;
  contactRole: string;
  idempotencyKeyPrefix: string;
}): Promise<boolean | null> => {
  const clientResolution = resolveBillingApiSummaryClient({ env });
  if (!clientResolution.enabled) {
    return null;
  }

  try {
    const rows = await database
      .select({
        id: dbSchema.organization.id,
        name: dbSchema.organization.name,
        slug: dbSchema.organization.slug,
      })
      .from(dbSchema.organization)
      .where(eq(dbSchema.organization.id, organizationId))
      .limit(1);
    const organization = rows[0];
    if (!organization) {
      return null;
    }

    const summary = await readBillingApiSummary({
      clientResolution,
      subject: {
        organizationId: organization.id,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        billingEmail: null,
      },
      contactRole,
      idempotencyKeyPrefix,
    });
    return summary ? readBillingApiFeatureEntitlement({ summary, key }) : null;
  } catch {
    return null;
  }
};
