import { describe, expect, it } from 'vitest';
import {
  buildBillingDocumentReadiness,
  buildInternalBillingDocumentInspection,
  normalizeStripeChargeReceiptDocument,
  normalizeStripeInvoiceDocument,
} from './reserve-app-billing-documents.js';

describe('reserve-app 課金ドキュメント準備状態', () => {
  it('プロバイダーペイロードから利用可能な請求書・領収書ドキュメント参照を正規化する', () => {
    const invoice = normalizeStripeInvoiceDocument({
      id: 'in_available',
      customer: 'cus_documents',
      subscription: 'sub_documents',
      hosted_invoice_url: 'https://invoice.stripe.com/i/in_available',
      invoice_pdf: 'https://invoice.stripe.com/i/in_available.pdf',
    });
    const receipt = normalizeStripeChargeReceiptDocument({
      id: 'ch_available',
      customer: 'cus_documents',
      receipt_url: 'https://pay.stripe.com/receipts/ch_available',
    });

    expect(invoice).toMatchObject({
      aggregateRoot: 'billing_account',
      documentKind: 'invoice',
      providerDocumentId: 'in_available',
      stripeCustomerId: 'cus_documents',
      stripeSubscriptionId: 'sub_documents',
      availability: 'available',
      ownerFacingStatus: 'available',
    });
    expect(receipt).toMatchObject({
      aggregateRoot: 'billing_account',
      documentKind: 'receipt',
      providerDocumentId: 'ch_available',
      stripeCustomerId: 'cus_documents',
      availability: 'available',
      ownerFacingStatus: 'available',
    });
  });

  it('生の支払い詳細を含めず利用不可・欠落・確認中のドキュメント状態を区別する', () => {
    const unavailableInvoice = normalizeStripeInvoiceDocument({
      id: 'in_unavailable',
      customer: 'cus_documents',
      subscription: 'sub_documents',
    });
    const missingReceipt = normalizeStripeChargeReceiptDocument(null);
    const readiness = buildBillingDocumentReadiness({
      organizationId: 'org_documents',
      stripeCustomerId: 'cus_documents',
      stripeSubscriptionId: 'sub_documents',
      documents: [
        unavailableInvoice,
        missingReceipt,
        {
          aggregateRoot: 'billing_account',
          documentKind: 'invoice',
          documentConcepts: ['invoice', 'payment_document', 'provider_document'],
          provider: 'stripe',
          providerDocumentId: 'in_checking',
          stripeCustomerId: 'cus_documents',
          stripeSubscriptionId: 'sub_documents',
          hostedInvoiceUrl: null,
          invoicePdfUrl: null,
          receiptUrl: null,
          availability: 'checking',
          ownerFacingStatus: 'checking',
        },
      ],
    });

    expect(readiness).toMatchObject({
      aggregateRoot: 'billing_account',
      ownerAccess: 'owner_only',
      persistenceStrategy: 'provider_reference_only',
      documents: [
        {
          documentKind: 'invoice',
          providerDocumentId: 'in_unavailable',
          availability: 'unavailable',
          ownerFacingStatus: 'unavailable',
        },
        {
          documentKind: 'receipt',
          providerDocumentId: 'missing_receipt',
          availability: 'missing',
          ownerFacingStatus: 'unavailable',
        },
        {
          documentKind: 'invoice',
          providerDocumentId: 'in_checking',
          availability: 'checking',
          ownerFacingStatus: 'checking',
        },
      ],
    });

    const inspection = buildInternalBillingDocumentInspection({
      readiness,
      diagnosticReason: 'provider_document_sync_pending',
    });
    expect(inspection).toMatchObject({
      diagnosticReason: 'provider_document_sync_pending',
      documents: [
        expect.objectContaining({ providerDerived: true }),
        expect.objectContaining({ providerDerived: true }),
        expect.objectContaining({ providerDerived: true }),
      ],
    });
    expect(JSON.stringify(inspection)).not.toContain('card');
    expect(JSON.stringify(inspection)).not.toContain('payment_method_details');
  });
});
