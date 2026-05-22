import { and, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import * as dbSchema from '../../infra/db/schema.js';
import type { OrganizationBillingProviderDocumentReference } from './organization-billing-documents.js';

type BillingV2Snapshot = Record<string, unknown>;

const toSnapshotJson = (snapshot: BillingV2Snapshot | null | undefined) =>
  snapshot ? JSON.stringify(snapshot) : null;

const resolveProviderCustomerId = (...values: Array<string | null | undefined>) =>
  values.find((value): value is string => Boolean(value?.trim())) ?? null;

const ensureOrganizationBillingV2Account = async ({
  database,
  organizationId,
  providerCustomerId = null,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  providerCustomerId?: string | null;
}) => {
  const insertedRows = await database
    .insert(dbSchema.billingAccount)
    .values({
      id: crypto.randomUUID(),
      subjectType: 'organization',
      subjectId: organizationId,
      provider: 'stripe',
      providerCustomerId,
    })
    .onConflictDoNothing()
    .returning({
      id: dbSchema.billingAccount.id,
      providerCustomerId: dbSchema.billingAccount.providerCustomerId,
    });
  const inserted = insertedRows[0];
  if (inserted) {
    return inserted;
  }

  const rows = await database
    .select({
      id: dbSchema.billingAccount.id,
      providerCustomerId: dbSchema.billingAccount.providerCustomerId,
    })
    .from(dbSchema.billingAccount)
    .where(
      and(
        eq(dbSchema.billingAccount.subjectType, 'organization'),
        eq(dbSchema.billingAccount.subjectId, organizationId),
      ),
    )
    .limit(1);
  const account = rows[0];
  if (!account) {
    throw new Error('BILLING_V2_ACCOUNT_ENSURE_FAILED');
  }

  if (providerCustomerId && account.providerCustomerId !== providerCustomerId) {
    await database
      .update(dbSchema.billingAccount)
      .set({
        providerCustomerId,
        updatedAt: new Date(),
      })
      .where(eq(dbSchema.billingAccount.id, account.id));
    return {
      ...account,
      providerCustomerId,
    };
  }

  return account;
};

export const appendOrganizationBillingV2AuditEvent = async ({
  database,
  organizationId,
  sourceKind,
  previousSnapshot,
  nextSnapshot,
  stripeEventId,
  sourceContext,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  sourceKind: string;
  previousSnapshot: BillingV2Snapshot;
  nextSnapshot: BillingV2Snapshot;
  stripeEventId?: string | null;
  sourceContext?: string | null;
}) => {
  const providerCustomerId = resolveProviderCustomerId(
    nextSnapshot.stripeCustomerId as string | null | undefined,
    previousSnapshot.stripeCustomerId as string | null | undefined,
  );
  const providerSubscriptionId = resolveProviderCustomerId(
    nextSnapshot.stripeSubscriptionId as string | null | undefined,
    previousSnapshot.stripeSubscriptionId as string | null | undefined,
  );
  const account = await ensureOrganizationBillingV2Account({
    database,
    organizationId,
    providerCustomerId,
  });

  await database.insert(dbSchema.billingAuditEvent).values({
    id: crypto.randomUUID(),
    billingAccountId: account.id,
    sourceKind,
    sourceContext: sourceContext ?? null,
    previousSnapshotJson: toSnapshotJson(previousSnapshot),
    nextSnapshotJson: toSnapshotJson(nextSnapshot),
    provider: providerCustomerId || providerSubscriptionId || stripeEventId ? 'stripe' : null,
    providerEventId: stripeEventId ?? null,
    providerCustomerId,
    providerSubscriptionId,
  });
};

export const appendOrganizationBillingV2Signal = async ({
  database,
  organizationId,
  signalKind,
  signalStatus,
  sourceKind,
  reason,
  appSnapshot,
  stripeEventId,
  stripeCustomerId,
  stripeSubscriptionId,
  providerPlanState,
  providerSubscriptionStatus,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  signalKind: string;
  signalStatus: string;
  sourceKind: string;
  reason: string;
  appSnapshot: BillingV2Snapshot;
  stripeEventId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  providerPlanState?: string | null;
  providerSubscriptionStatus?: string | null;
}) => {
  const providerCustomerId = stripeCustomerId ?? (appSnapshot.stripeCustomerId as string | null);
  const providerSubscriptionId =
    stripeSubscriptionId ?? (appSnapshot.stripeSubscriptionId as string | null);
  const account = await ensureOrganizationBillingV2Account({
    database,
    organizationId,
    providerCustomerId,
  });

  await database.insert(dbSchema.billingSignal).values({
    id: crypto.randomUUID(),
    billingAccountId: account.id,
    signalKind,
    signalStatus,
    sourceKind,
    reason,
    appSnapshotJson: toSnapshotJson(appSnapshot),
    provider: providerCustomerId || providerSubscriptionId || stripeEventId ? 'stripe' : null,
    providerEventId: stripeEventId ?? null,
    providerCustomerId,
    providerSubscriptionId,
    providerPlanState: providerPlanState ?? null,
    providerSubscriptionStatus: providerSubscriptionStatus ?? null,
  });
};

const toBillingV2DeliveryStatus = (deliveryState: string) => {
  if (deliveryState === 'sent') {
    return 'sent';
  }
  if (deliveryState === 'failed') {
    return 'failed';
  }
  if (deliveryState === 'skipped') {
    return 'skipped';
  }
  return 'pending';
};

export const upsertOrganizationBillingV2Notification = async ({
  database,
  organizationId,
  notificationKind,
  recipientUserId,
  recipientEmail,
  deliveryState,
  failureReason,
  stripeEventId,
  stripeCustomerId,
  stripeSubscriptionId,
  stripeInvoiceId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  notificationKind: string;
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  deliveryState: string;
  failureReason?: string | null;
  stripeEventId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeInvoiceId?: string | null;
}) => {
  if (!recipientEmail) {
    return;
  }

  const account = await ensureOrganizationBillingV2Account({
    database,
    organizationId,
    providerCustomerId: stripeCustomerId ?? null,
  });
  const now = new Date();
  const deliveryStatus = toBillingV2DeliveryStatus(deliveryState);
  const values = {
    id: crypto.randomUUID(),
    billingAccountId: account.id,
    notificationKind,
    recipientUserId: recipientUserId ?? null,
    recipientEmail,
    deliveryStatus,
    failureReason: failureReason ?? null,
    provider: 'stripe',
    providerEventId: stripeEventId ?? null,
    providerInvoiceId: stripeInvoiceId ?? null,
    sentAt: deliveryStatus === 'sent' ? now : null,
    failedAt: deliveryStatus === 'failed' ? now : null,
  };

  if (deliveryStatus === 'skipped') {
    await database.insert(dbSchema.billingNotification).values(values).onConflictDoNothing();
    return;
  }

  await database
    .insert(dbSchema.billingNotification)
    .values(values)
    .onConflictDoUpdate({
      target: [
        dbSchema.billingNotification.billingAccountId,
        dbSchema.billingNotification.notificationKind,
        dbSchema.billingNotification.recipientEmail,
        dbSchema.billingNotification.providerEventId,
      ],
      set: {
        recipientUserId: recipientUserId ?? null,
        deliveryStatus,
        failureReason: failureReason ?? null,
        provider: 'stripe',
        providerInvoiceId: stripeInvoiceId ?? null,
        sentAt: deliveryStatus === 'sent' ? now : null,
        failedAt: deliveryStatus === 'failed' ? now : null,
      },
    });
};

export const upsertOrganizationBillingV2DocumentReferences = async ({
  database,
  organizationId,
  documentReferences,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  documentReferences: OrganizationBillingProviderDocumentReference[];
}) => {
  if (documentReferences.length === 0) {
    return;
  }

  const account = await ensureOrganizationBillingV2Account({
    database,
    organizationId,
  });

  for (const document of documentReferences) {
    await database
      .insert(dbSchema.billingDocumentReference)
      .values({
        id: crypto.randomUUID(),
        billingAccountId: account.id,
        documentKind: document.documentKind === 'receipt' ? 'receipt' : 'invoice',
        provider: 'stripe',
        providerDocumentId: document.providerDocumentId,
        hostedInvoiceUrl: document.hostedInvoiceUrl,
        invoicePdfUrl: document.invoicePdfUrl,
        receiptUrl: document.receiptUrl,
        availability: document.availability,
        ownerFacingStatus: document.ownerFacingStatus,
        providerDerived: true,
      })
      .onConflictDoUpdate({
        target: [
          dbSchema.billingDocumentReference.provider,
          dbSchema.billingDocumentReference.providerDocumentId,
          dbSchema.billingDocumentReference.documentKind,
        ],
        set: {
          billingAccountId: account.id,
          hostedInvoiceUrl: document.hostedInvoiceUrl,
          invoicePdfUrl: document.invoicePdfUrl,
          receiptUrl: document.receiptUrl,
          availability: document.availability,
          ownerFacingStatus: document.ownerFacingStatus,
          providerDerived: true,
          updatedAt: new Date(),
        },
      });
  }
};
