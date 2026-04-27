import { describe, expect, it } from 'vitest';
import {
  buildBillingDocumentReadiness,
  describeBillingDocumentCompatibilityStrategy,
  buildInternalBillingDocumentInspection,
  buildOwnerSafeBillingDocumentHistoryEntry,
  normalizeStripeChargeReceiptDocument,
  normalizeStripeInvoiceDocument,
} from './organization-billing-documents.js';

describe('organization billing document readiness', () => {
  it('keeps invoice and receipt references provider-derived under organization_billing', () => {
    const invoice = normalizeStripeInvoiceDocument({
      id: 'in_123',
      customer: 'cus_123',
      subscription: 'sub_123',
      hosted_invoice_url: 'https://invoice.stripe.com/i/in_123',
      invoice_pdf: 'https://pay.stripe.com/invoice/acct/in_123/pdf',
      amount_paid: 5500,
      currency: 'jpy',
      payment_intent: {
        id: 'pi_123',
        latest_charge: {
          id: 'ch_123',
          receipt_url: 'https://pay.stripe.com/receipts/ch_123',
          payment_method_details: {
            card: {
              last4: '4242',
              brand: 'visa',
            },
          },
        },
      },
    });

    expect(invoice).toEqual({
      aggregateRoot: 'organization_billing',
      documentKind: 'invoice',
      documentConcepts: ['invoice', 'payment_document', 'provider_document'],
      provider: 'stripe',
      providerDocumentId: 'in_123',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_123',
      invoicePdfUrl: 'https://pay.stripe.com/invoice/acct/in_123/pdf',
      receiptUrl: null,
      availability: 'available',
      ownerFacingStatus: 'available',
    });
    expect(JSON.stringify(invoice)).not.toContain('4242');
    expect(JSON.stringify(invoice)).not.toContain('visa');
  });

  it('normalizes receipts separately from invoice PDFs and treats missing URLs as owner-safe unavailable state', () => {
    const availableReceipt = normalizeStripeChargeReceiptDocument({
      id: 'ch_123',
      customer: { id: 'cus_123' },
      receipt_url: 'https://pay.stripe.com/receipts/ch_123',
      payment_method_details: {
        card: {
          last4: '4242',
        },
      },
    });
    const unavailableReceipt = normalizeStripeChargeReceiptDocument({
      id: 'ch_456',
      customer: 'cus_123',
      receipt_url: null,
      failure_message: 'card_declined',
    });

    expect(availableReceipt).toMatchObject({
      aggregateRoot: 'organization_billing',
      documentKind: 'receipt',
      documentConcepts: ['receipt', 'payment_document', 'provider_document'],
      providerDocumentId: 'ch_123',
      receiptUrl: 'https://pay.stripe.com/receipts/ch_123',
      invoicePdfUrl: null,
      availability: 'available',
      ownerFacingStatus: 'available',
    });
    expect(unavailableReceipt).toMatchObject({
      providerDocumentId: 'ch_456',
      receiptUrl: null,
      availability: 'unavailable',
      ownerFacingStatus: 'unavailable',
    });
    expect(JSON.stringify(availableReceipt)).not.toContain('4242');
    expect(JSON.stringify(unavailableReceipt)).not.toContain('card_declined');
  });

  it('builds owner-safe and internal projections from the same provider-derived document boundary', () => {
    const readiness = buildBillingDocumentReadiness({
      organizationId: 'org_123',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      documents: [
        normalizeStripeInvoiceDocument({
          id: 'in_123',
          customer: 'cus_123',
          subscription: 'sub_123',
          hosted_invoice_url: 'https://invoice.stripe.com/i/in_123',
          invoice_pdf: 'https://pay.stripe.com/invoice/acct/in_123/pdf',
        }),
      ],
    });

    expect(readiness).toEqual({
      aggregateRoot: 'organization_billing',
      organizationId: 'org_123',
      provider: 'stripe',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      ownerAccess: 'owner_only',
      persistenceStrategy: 'provider_reference_only',
      documents: [
        {
          documentKind: 'invoice',
          providerDocumentId: 'in_123',
          hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_123',
          invoicePdfUrl: 'https://pay.stripe.com/invoice/acct/in_123/pdf',
          receiptUrl: null,
          availability: 'available',
          ownerFacingStatus: 'available',
        },
      ],
    });

    const ownerEntry = buildOwnerSafeBillingDocumentHistoryEntry(readiness);
    expect(ownerEntry).toMatchObject({
      eventType: 'payment_document',
      title: '請求書・領収書の参照準備ができています',
      tone: 'neutral',
    });
    expect(JSON.stringify(ownerEntry)).not.toContain('provider_lookup_failed');

    const inspection = buildInternalBillingDocumentInspection({
      readiness,
      diagnosticReason: 'provider_lookup_failed',
    });
    expect(inspection).toMatchObject({
      aggregateRoot: 'organization_billing',
      provider: 'stripe',
      diagnosticReason: 'provider_lookup_failed',
      documents: [
        {
          providerDocumentId: 'in_123',
          providerDerived: true,
        },
      ],
    });
  });

  it('treats existing billing rows without document metadata as compatible legacy state', () => {
    expect(
      describeBillingDocumentCompatibilityStrategy({
        hasOrganizationBillingRow: true,
        persistedDocumentReferenceCount: 0,
      }),
    ).toEqual({
      legacyState: 'valid_without_document_metadata',
      mismatchState: 'not_a_billing_mismatch',
      persistencePreference: 'append_only_provider_reference_if_needed',
      sourceOfTruth: 'stripe_provider_pull_or_portal_handoff',
    });
  });
});
