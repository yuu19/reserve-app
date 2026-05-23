import { and, desc, eq, or } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { ensureReserveAppBillingV2State } from '../../infra/billing/reserve-app-billing-v2-source.js';
import * as dbSchema from '../../infra/db/schema.js';
import type {
  ReserveAppBillingDocumentAvailability,
  ReserveAppBillingDocumentKind,
  ReserveAppBillingDocumentOwnerFacingStatus,
  ReserveAppBillingProviderDocumentReference,
} from './reserve-app-billing-documents.js';

export type ReserveAppBillingInvoiceEventType =
  | 'invoice_available'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'payment_action_required';
export type ReserveAppBillingInvoiceEventOwnerFacingStatus =
  | 'available'
  | 'checking'
  | 'missing'
  | 'action_required'
  | 'failed'
  | 'succeeded';

export type ReserveAppBillingInvoiceEvent = {
  id: string;
  organizationId: string;
  stripeEventId: string | null;
  eventType: ReserveAppBillingInvoiceEventType;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeInvoiceId: string | null;
  stripePaymentIntentId: string | null;
  providerStatus: string | null;
  ownerFacingStatus: ReserveAppBillingInvoiceEventOwnerFacingStatus;
  occurredAt: string | null;
  createdAt: string | null;
};

const toIsoDateString = (value: unknown): string | null => {
  const candidate =
    value instanceof Date
      ? value
      : typeof value === 'number' || typeof value === 'string'
        ? new Date(value)
        : null;

  if (!candidate || Number.isNaN(candidate.getTime())) {
    return null;
  }

  return candidate.toISOString();
};

export const normalizeInvoicePaymentEventType = (
  value: unknown,
): ReserveAppBillingInvoiceEventType | null => {
  return value === 'invoice_available' ||
    value === 'payment_succeeded' ||
    value === 'payment_failed' ||
    value === 'payment_action_required'
    ? value
    : null;
};

export const normalizeInvoicePaymentOwnerFacingStatus = (
  value: unknown,
): ReserveAppBillingInvoiceEventOwnerFacingStatus => {
  return value === 'available' ||
    value === 'checking' ||
    value === 'missing' ||
    value === 'action_required' ||
    value === 'failed' ||
    value === 'succeeded'
    ? value
    : 'checking';
};

const normalizeDocumentKind = (value: unknown): ReserveAppBillingDocumentKind =>
  value === 'receipt' ? 'receipt' : 'invoice';

const normalizeDocumentAvailability = (value: unknown): ReserveAppBillingDocumentAvailability => {
  return value === 'available' ||
    value === 'unavailable' ||
    value === 'missing' ||
    value === 'checking'
    ? value
    : 'checking';
};

const normalizeDocumentOwnerFacingStatus = (
  value: unknown,
): ReserveAppBillingDocumentOwnerFacingStatus => {
  return value === 'available' || value === 'unavailable' || value === 'checking'
    ? value
    : 'checking';
};

const toInvoicePaymentEvent = (row: {
  id: string;
  organizationId: string;
  stripeEventId: string | null;
  eventType: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeInvoiceId: string | null;
  stripePaymentIntentId: string | null;
  providerStatus: string | null;
  ownerFacingStatus: string | null;
  occurredAt: unknown;
  createdAt: unknown;
}): ReserveAppBillingInvoiceEvent => ({
  id: row.id,
  organizationId: row.organizationId,
  stripeEventId: row.stripeEventId ?? null,
  eventType: normalizeInvoicePaymentEventType(row.eventType) ?? 'invoice_available',
  stripeCustomerId: row.stripeCustomerId ?? null,
  stripeSubscriptionId: row.stripeSubscriptionId ?? null,
  stripeInvoiceId: row.stripeInvoiceId ?? null,
  stripePaymentIntentId: row.stripePaymentIntentId ?? null,
  providerStatus: row.providerStatus ?? null,
  ownerFacingStatus: normalizeInvoicePaymentOwnerFacingStatus(row.ownerFacingStatus),
  occurredAt: toIsoDateString(row.occurredAt),
  createdAt: toIsoDateString(row.createdAt),
});

export const appendReserveAppBillingInvoiceEvent = async ({
  database,
  organizationId,
  stripeEventId = null,
  eventType,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripeInvoiceId = null,
  stripePaymentIntentId = null,
  providerStatus = null,
  ownerFacingStatus,
  occurredAt = new Date(),
  documentReferences = [],
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  stripeEventId?: string | null;
  eventType: ReserveAppBillingInvoiceEventType;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  providerStatus?: string | null;
  ownerFacingStatus: ReserveAppBillingInvoiceEventOwnerFacingStatus;
  occurredAt?: Date | null;
  documentReferences?: ReserveAppBillingProviderDocumentReference[];
}) => {
  const state = await ensureReserveAppBillingV2State({
    database,
    organizationId,
  });
  const insertedRows = await database
    .insert(dbSchema.billingInvoiceEvent)
    .values({
      id: crypto.randomUUID(),
      billingAccountId: state.account.id,
      billingSubscriptionId: state.subscription.id,
      provider: 'stripe',
      providerEventId: stripeEventId,
      eventType,
      providerInvoiceId: stripeInvoiceId,
      providerPaymentIntentId: stripePaymentIntentId,
      providerStatus,
      ownerFacingStatus,
      occurredAt,
    })
    .onConflictDoNothing()
    .returning();

  const eventRow =
    insertedRows[0] ??
    (stripeEventId
      ? await database
          .select()
          .from(dbSchema.billingInvoiceEvent)
          .where(eq(dbSchema.billingInvoiceEvent.providerEventId, stripeEventId))
          .limit(1)
      : [])[0];

  if (!eventRow) {
    return null;
  }

  for (const document of documentReferences) {
    await database
      .insert(dbSchema.billingDocumentReference)
      .values({
        id: crypto.randomUUID(),
        billingAccountId: state.account.id,
        documentKind: normalizeDocumentKind(document.documentKind),
        provider: 'stripe',
        providerDocumentId: document.providerDocumentId,
        providerCustomerId: document.stripeCustomerId ?? stripeCustomerId ?? null,
        providerSubscriptionId: document.stripeSubscriptionId ?? stripeSubscriptionId ?? null,
        hostedInvoiceUrl: document.hostedInvoiceUrl,
        invoicePdfUrl: document.invoicePdfUrl,
        receiptUrl: document.receiptUrl,
        availability: normalizeDocumentAvailability(document.availability),
        ownerFacingStatus: normalizeDocumentOwnerFacingStatus(document.ownerFacingStatus),
        providerDerived: true,
      })
      .onConflictDoUpdate({
        target: [
          dbSchema.billingDocumentReference.provider,
          dbSchema.billingDocumentReference.providerDocumentId,
          dbSchema.billingDocumentReference.documentKind,
        ],
        set: {
          billingAccountId: state.account.id,
          providerCustomerId: document.stripeCustomerId ?? stripeCustomerId ?? null,
          providerSubscriptionId: document.stripeSubscriptionId ?? stripeSubscriptionId ?? null,
          hostedInvoiceUrl: document.hostedInvoiceUrl,
          invoicePdfUrl: document.invoicePdfUrl,
          receiptUrl: document.receiptUrl,
          availability: normalizeDocumentAvailability(document.availability),
          ownerFacingStatus: normalizeDocumentOwnerFacingStatus(document.ownerFacingStatus),
          providerDerived: true,
          updatedAt: new Date(),
        },
      });
  }

  return toInvoicePaymentEvent({
    id: eventRow.id,
    organizationId,
    stripeEventId: eventRow.providerEventId ?? null,
    eventType: eventRow.eventType,
    stripeCustomerId,
    stripeSubscriptionId,
    stripeInvoiceId: eventRow.providerInvoiceId ?? null,
    stripePaymentIntentId: eventRow.providerPaymentIntentId ?? null,
    providerStatus: eventRow.providerStatus ?? null,
    ownerFacingStatus: eventRow.ownerFacingStatus ?? null,
    occurredAt: eventRow.occurredAt,
    createdAt: eventRow.createdAt,
  });
};

export const readReserveAppBillingInvoiceEvents = async ({
  database,
  organizationId,
  limit = 20,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  limit?: number;
}) => {
  const rows = await database
    .select({
      id: dbSchema.billingInvoiceEvent.id,
      organizationId: dbSchema.billingAccount.subjectId,
      stripeEventId: dbSchema.billingInvoiceEvent.providerEventId,
      eventType: dbSchema.billingInvoiceEvent.eventType,
      stripeCustomerId: dbSchema.billingAccount.providerCustomerId,
      stripeSubscriptionId: dbSchema.billingSubscription.providerSubscriptionId,
      stripeInvoiceId: dbSchema.billingInvoiceEvent.providerInvoiceId,
      stripePaymentIntentId: dbSchema.billingInvoiceEvent.providerPaymentIntentId,
      providerStatus: dbSchema.billingInvoiceEvent.providerStatus,
      ownerFacingStatus: dbSchema.billingInvoiceEvent.ownerFacingStatus,
      occurredAt: dbSchema.billingInvoiceEvent.occurredAt,
      createdAt: dbSchema.billingInvoiceEvent.createdAt,
    })
    .from(dbSchema.billingInvoiceEvent)
    .innerJoin(
      dbSchema.billingAccount,
      eq(dbSchema.billingInvoiceEvent.billingAccountId, dbSchema.billingAccount.id),
    )
    .leftJoin(
      dbSchema.billingSubscription,
      eq(dbSchema.billingInvoiceEvent.billingSubscriptionId, dbSchema.billingSubscription.id),
    )
    .where(
      and(
        eq(dbSchema.billingAccount.subjectType, 'organization'),
        eq(dbSchema.billingAccount.subjectId, organizationId),
        or(
          eq(dbSchema.billingInvoiceEvent.eventType, 'invoice_available'),
          eq(dbSchema.billingInvoiceEvent.eventType, 'payment_succeeded'),
          eq(dbSchema.billingInvoiceEvent.eventType, 'payment_failed'),
          eq(dbSchema.billingInvoiceEvent.eventType, 'payment_action_required'),
        ),
      ),
    )
    .orderBy(desc(dbSchema.billingInvoiceEvent.createdAt))
    .limit(Math.max(1, Math.min(Math.trunc(limit), 50)));

  return rows.map(toInvoicePaymentEvent);
};

export const readReserveAppBillingDocumentReferences = async ({
  database,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
}) => {
  const rows = await database
    .select({
      documentKind: dbSchema.billingDocumentReference.documentKind,
      providerDocumentId: dbSchema.billingDocumentReference.providerDocumentId,
      providerCustomerId: dbSchema.billingDocumentReference.providerCustomerId,
      accountProviderCustomerId: dbSchema.billingAccount.providerCustomerId,
      providerSubscriptionId: dbSchema.billingDocumentReference.providerSubscriptionId,
      hostedInvoiceUrl: dbSchema.billingDocumentReference.hostedInvoiceUrl,
      invoicePdfUrl: dbSchema.billingDocumentReference.invoicePdfUrl,
      receiptUrl: dbSchema.billingDocumentReference.receiptUrl,
      availability: dbSchema.billingDocumentReference.availability,
      ownerFacingStatus: dbSchema.billingDocumentReference.ownerFacingStatus,
    })
    .from(dbSchema.billingDocumentReference)
    .innerJoin(
      dbSchema.billingAccount,
      eq(dbSchema.billingDocumentReference.billingAccountId, dbSchema.billingAccount.id),
    )
    .where(
      and(
        eq(dbSchema.billingAccount.subjectType, 'organization'),
        eq(dbSchema.billingAccount.subjectId, organizationId),
      ),
    )
    .orderBy(desc(dbSchema.billingDocumentReference.createdAt));

  return rows.map((row: (typeof rows)[number]) => ({
    aggregateRoot: 'billing_account' as const,
    documentKind: normalizeDocumentKind(row.documentKind),
    documentConcepts: [
      row.documentKind === 'receipt' ? 'receipt' : 'invoice',
      'payment_document',
      'provider_document',
    ] as const,
    provider: 'stripe' as const,
    providerDocumentId: row.providerDocumentId,
    stripeCustomerId: row.providerCustomerId ?? row.accountProviderCustomerId,
    stripeSubscriptionId: row.providerSubscriptionId ?? null,
    hostedInvoiceUrl: row.hostedInvoiceUrl ?? null,
    invoicePdfUrl: row.invoicePdfUrl ?? null,
    receiptUrl: row.receiptUrl ?? null,
    availability: normalizeDocumentAvailability(row.availability),
    ownerFacingStatus: normalizeDocumentOwnerFacingStatus(row.ownerFacingStatus),
  }));
};
