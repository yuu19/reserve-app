import { desc, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import type {
  OrganizationBillingDocumentAvailability,
  OrganizationBillingDocumentKind,
  OrganizationBillingDocumentOwnerFacingStatus,
  OrganizationBillingProviderDocumentReference,
} from './organization-billing-documents.js';

export type OrganizationBillingInvoicePaymentEventType =
  | 'invoice_available'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'payment_action_required';
export type OrganizationBillingInvoicePaymentOwnerFacingStatus =
  | 'available'
  | 'checking'
  | 'missing'
  | 'action_required'
  | 'failed'
  | 'succeeded';

export type OrganizationBillingInvoicePaymentEvent = {
  id: string;
  organizationId: string;
  stripeEventId: string | null;
  eventType: OrganizationBillingInvoicePaymentEventType;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeInvoiceId: string | null;
  stripePaymentIntentId: string | null;
  providerStatus: string | null;
  ownerFacingStatus: OrganizationBillingInvoicePaymentOwnerFacingStatus;
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
): OrganizationBillingInvoicePaymentEventType | null => {
  return value === 'invoice_available' ||
    value === 'payment_succeeded' ||
    value === 'payment_failed' ||
    value === 'payment_action_required'
    ? value
    : null;
};

export const normalizeInvoicePaymentOwnerFacingStatus = (
  value: unknown,
): OrganizationBillingInvoicePaymentOwnerFacingStatus => {
  return value === 'available' ||
    value === 'checking' ||
    value === 'missing' ||
    value === 'action_required' ||
    value === 'failed' ||
    value === 'succeeded'
    ? value
    : 'checking';
};

const normalizeDocumentKind = (value: unknown): OrganizationBillingDocumentKind =>
  value === 'receipt' ? 'receipt' : 'invoice';

const normalizeDocumentAvailability = (value: unknown): OrganizationBillingDocumentAvailability => {
  return value === 'available' ||
    value === 'unavailable' ||
    value === 'missing' ||
    value === 'checking'
    ? value
    : 'checking';
};

const normalizeDocumentOwnerFacingStatus = (
  value: unknown,
): OrganizationBillingDocumentOwnerFacingStatus => {
  return value === 'available' || value === 'unavailable' || value === 'checking'
    ? value
    : 'checking';
};

const toInvoicePaymentEvent = (
  row: typeof dbSchema.organizationBillingInvoiceEvent.$inferSelect,
): OrganizationBillingInvoicePaymentEvent => ({
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

export const appendOrganizationBillingInvoicePaymentEvent = async ({
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
  eventType: OrganizationBillingInvoicePaymentEventType;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  providerStatus?: string | null;
  ownerFacingStatus: OrganizationBillingInvoicePaymentOwnerFacingStatus;
  occurredAt?: Date | null;
  documentReferences?: OrganizationBillingProviderDocumentReference[];
}) => {
  const insertedRows = await database
    .insert(dbSchema.organizationBillingInvoiceEvent)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      stripeEventId,
      eventType,
      stripeCustomerId,
      stripeSubscriptionId,
      stripeInvoiceId,
      stripePaymentIntentId,
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
          .from(dbSchema.organizationBillingInvoiceEvent)
          .where(eq(dbSchema.organizationBillingInvoiceEvent.stripeEventId, stripeEventId))
          .limit(1)
      : [])[0];

  if (!eventRow) {
    return null;
  }

  for (const document of documentReferences) {
    await database
      .insert(dbSchema.organizationBillingDocumentReference)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        invoiceEventId: eventRow.id,
        documentKind: normalizeDocumentKind(document.documentKind),
        providerDocumentId: document.providerDocumentId,
        hostedInvoiceUrl: document.hostedInvoiceUrl,
        invoicePdfUrl: document.invoicePdfUrl,
        receiptUrl: document.receiptUrl,
        availability: normalizeDocumentAvailability(document.availability),
        ownerFacingStatus: normalizeDocumentOwnerFacingStatus(document.ownerFacingStatus),
        providerDerived: true,
      })
      .onConflictDoUpdate({
        target: [
          dbSchema.organizationBillingDocumentReference.organizationId,
          dbSchema.organizationBillingDocumentReference.documentKind,
          dbSchema.organizationBillingDocumentReference.providerDocumentId,
        ],
        set: {
          invoiceEventId: eventRow.id,
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

  return toInvoicePaymentEvent(eventRow);
};

export const readOrganizationBillingInvoicePaymentEvents = async ({
  database,
  organizationId,
  limit = 20,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  limit?: number;
}) => {
  const rows = await database
    .select()
    .from(dbSchema.organizationBillingInvoiceEvent)
    .where(eq(dbSchema.organizationBillingInvoiceEvent.organizationId, organizationId))
    .orderBy(desc(dbSchema.organizationBillingInvoiceEvent.createdAt))
    .limit(Math.max(1, Math.min(Math.trunc(limit), 50)));

  return rows.map(toInvoicePaymentEvent);
};

export const readOrganizationBillingDocumentReferences = async ({
  database,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
}) => {
  const rows = await database
    .select()
    .from(dbSchema.organizationBillingDocumentReference)
    .where(eq(dbSchema.organizationBillingDocumentReference.organizationId, organizationId))
    .orderBy(desc(dbSchema.organizationBillingDocumentReference.createdAt));

  return rows.map((row: (typeof rows)[number]) => ({
    aggregateRoot: 'organization_billing' as const,
    documentKind: normalizeDocumentKind(row.documentKind),
    documentConcepts: [
      row.documentKind === 'receipt' ? 'receipt' : 'invoice',
      'payment_document',
      'provider_document',
    ] as const,
    provider: 'stripe' as const,
    providerDocumentId: row.providerDocumentId,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    hostedInvoiceUrl: row.hostedInvoiceUrl ?? null,
    invoicePdfUrl: row.invoicePdfUrl ?? null,
    receiptUrl: row.receiptUrl ?? null,
    availability: normalizeDocumentAvailability(row.availability),
    ownerFacingStatus: normalizeDocumentOwnerFacingStatus(row.ownerFacingStatus),
  }));
};
