export type OrganizationBillingDocumentKind = 'invoice' | 'receipt';
export type OrganizationBillingDocumentConcept =
  | 'invoice'
  | 'receipt'
  | 'payment_document'
  | 'provider_document';
export type OrganizationBillingDocumentAvailability = 'available' | 'unavailable' | 'missing';
export type OrganizationBillingDocumentOwnerFacingStatus = 'available' | 'unavailable';

export type OrganizationBillingProviderDocumentReference = {
  aggregateRoot: 'organization_billing';
  documentKind: OrganizationBillingDocumentKind;
  documentConcepts: OrganizationBillingDocumentConcept[];
  provider: 'stripe';
  providerDocumentId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  receiptUrl: string | null;
  availability: OrganizationBillingDocumentAvailability;
  ownerFacingStatus: OrganizationBillingDocumentOwnerFacingStatus;
};

export type OrganizationBillingDocumentReadiness = {
  aggregateRoot: 'organization_billing';
  organizationId: string;
  provider: 'stripe';
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  ownerAccess: 'owner_only';
  persistenceStrategy: 'provider_reference_only';
  documents: Array<{
    documentKind: OrganizationBillingDocumentKind;
    providerDocumentId: string;
    hostedInvoiceUrl: string | null;
    invoicePdfUrl: string | null;
    receiptUrl: string | null;
    availability: OrganizationBillingDocumentAvailability;
    ownerFacingStatus: OrganizationBillingDocumentOwnerFacingStatus;
  }>;
};

export type OrganizationBillingPaymentDocumentHistoryEntry = {
  id: string;
  eventType: 'payment_document';
  occurredAt: string | null;
  title: string;
  summary: string;
  billingContext: string | null;
  tone: 'neutral' | 'positive' | 'attention';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const readStripeId = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return readString(value);
  }
  if (!isRecord(value)) {
    return null;
  }
  return readString(value.id);
};

const resolveOwnerFacingStatus = (
  availability: OrganizationBillingDocumentAvailability,
): OrganizationBillingDocumentOwnerFacingStatus =>
  availability === 'available' ? 'available' : 'unavailable';

const resolveInvoiceAvailability = ({
  providerDocumentId,
  hostedInvoiceUrl,
  invoicePdfUrl,
}: {
  providerDocumentId: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
}): OrganizationBillingDocumentAvailability => {
  if (!providerDocumentId) {
    return 'missing';
  }
  return hostedInvoiceUrl || invoicePdfUrl ? 'available' : 'unavailable';
};

const resolveReceiptAvailability = ({
  providerDocumentId,
  receiptUrl,
}: {
  providerDocumentId: string | null;
  receiptUrl: string | null;
}): OrganizationBillingDocumentAvailability => {
  if (!providerDocumentId) {
    return 'missing';
  }
  return receiptUrl ? 'available' : 'unavailable';
};

export const normalizeStripeInvoiceDocument = (
  value: unknown,
): OrganizationBillingProviderDocumentReference => {
  const payload = isRecord(value) ? value : {};
  const providerDocumentId = readString(payload.id);
  const hostedInvoiceUrl = readString(payload.hosted_invoice_url);
  const invoicePdfUrl = readString(payload.invoice_pdf);
  const availability = resolveInvoiceAvailability({
    providerDocumentId,
    hostedInvoiceUrl,
    invoicePdfUrl,
  });

  return {
    aggregateRoot: 'organization_billing',
    documentKind: 'invoice',
    documentConcepts: ['invoice', 'payment_document', 'provider_document'],
    provider: 'stripe',
    providerDocumentId: providerDocumentId ?? 'missing_invoice',
    stripeCustomerId: readStripeId(payload.customer),
    stripeSubscriptionId: readStripeId(payload.subscription),
    hostedInvoiceUrl,
    invoicePdfUrl,
    receiptUrl: null,
    availability,
    ownerFacingStatus: resolveOwnerFacingStatus(availability),
  };
};

export const normalizeStripeChargeReceiptDocument = (
  value: unknown,
): OrganizationBillingProviderDocumentReference => {
  const payload = isRecord(value) ? value : {};
  const providerDocumentId = readString(payload.id);
  const receiptUrl = readString(payload.receipt_url);
  const availability = resolveReceiptAvailability({
    providerDocumentId,
    receiptUrl,
  });

  return {
    aggregateRoot: 'organization_billing',
    documentKind: 'receipt',
    documentConcepts: ['receipt', 'payment_document', 'provider_document'],
    provider: 'stripe',
    providerDocumentId: providerDocumentId ?? 'missing_receipt',
    stripeCustomerId: readStripeId(payload.customer),
    stripeSubscriptionId: null,
    hostedInvoiceUrl: null,
    invoicePdfUrl: null,
    receiptUrl,
    availability,
    ownerFacingStatus: resolveOwnerFacingStatus(availability),
  };
};

export const buildBillingDocumentReadiness = ({
  organizationId,
  stripeCustomerId,
  stripeSubscriptionId,
  documents,
}: {
  organizationId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  documents?: OrganizationBillingProviderDocumentReference[];
}): OrganizationBillingDocumentReadiness => ({
  aggregateRoot: 'organization_billing',
  organizationId,
  provider: 'stripe',
  stripeCustomerId: stripeCustomerId ?? null,
  stripeSubscriptionId: stripeSubscriptionId ?? null,
  ownerAccess: 'owner_only',
  persistenceStrategy: 'provider_reference_only',
  documents: (documents ?? []).map((document) => ({
    documentKind: document.documentKind,
    providerDocumentId: document.providerDocumentId,
    hostedInvoiceUrl: document.hostedInvoiceUrl,
    invoicePdfUrl: document.invoicePdfUrl,
    receiptUrl: document.receiptUrl,
    availability: document.availability,
    ownerFacingStatus: document.ownerFacingStatus,
  })),
});

export const buildOwnerSafeBillingDocumentHistoryEntry = (
  readiness: OrganizationBillingDocumentReadiness,
): OrganizationBillingPaymentDocumentHistoryEntry => {
  const availableCount = readiness.documents.filter(
    (document) => document.ownerFacingStatus === 'available',
  ).length;
  const documentCount = readiness.documents.length;

  return {
    id: `payment-document-readiness:${readiness.organizationId}`,
    eventType: 'payment_document',
    occurredAt: null,
    title:
      availableCount > 0
        ? '請求書・領収書の参照準備ができています'
        : '請求書・領収書の参照準備を進めています',
    summary:
      documentCount > 0
        ? `Stripe 上の請求書・領収書参照を ${availableCount}/${documentCount} 件確認できます。`
        : '将来の請求書・領収書参照は Stripe の提供情報をもとに表示します。',
    billingContext: [
      `アクセス: organization owner のみ`,
      `保存方針: provider reference only`,
      readiness.stripeCustomerId ? `Stripe customer: ${readiness.stripeCustomerId}` : null,
      readiness.stripeSubscriptionId ? `Stripe subscription: ${readiness.stripeSubscriptionId}` : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' / '),
    tone: 'neutral',
  };
};

export const buildInternalBillingDocumentInspection = ({
  readiness,
  diagnosticReason,
}: {
  readiness: OrganizationBillingDocumentReadiness;
  diagnosticReason?: string | null;
}) => ({
  aggregateRoot: 'organization_billing' as const,
  provider: 'stripe' as const,
  ownerAccess: readiness.ownerAccess,
  persistenceStrategy: readiness.persistenceStrategy,
  stripeCustomerId: readiness.stripeCustomerId,
  stripeSubscriptionId: readiness.stripeSubscriptionId,
  diagnosticReason: diagnosticReason ?? null,
  documents: readiness.documents.map((document) => ({
    ...document,
    providerDerived: true,
  })),
});

export const describeBillingDocumentCompatibilityStrategy = ({
  hasOrganizationBillingRow,
  persistedDocumentReferenceCount,
}: {
  hasOrganizationBillingRow: boolean;
  persistedDocumentReferenceCount: number;
}) => ({
  legacyState:
    hasOrganizationBillingRow && persistedDocumentReferenceCount === 0
      ? 'valid_without_document_metadata'
      : 'valid_with_provider_document_references',
  mismatchState: 'not_a_billing_mismatch' as const,
  persistencePreference: 'append_only_provider_reference_if_needed' as const,
  sourceOfTruth: 'stripe_provider_pull_or_portal_handoff' as const,
});
