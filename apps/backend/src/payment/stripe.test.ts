import { describe, expect, it } from 'vitest';
import {
  readStripeChargeReceiptDocumentSummary,
  readStripeInvoiceDocumentSummary,
} from './stripe.js';

describe('Stripe billing document adapter normalization', () => {
  it('normalizes hosted invoice and invoice PDF URLs without copying payment method details', () => {
    const summary = readStripeInvoiceDocumentSummary({
      id: 'in_adapter_123',
      customer: { id: 'cus_adapter_123' },
      subscription: 'sub_adapter_123',
      hosted_invoice_url: 'https://invoice.stripe.com/i/in_adapter_123',
      invoice_pdf: 'https://pay.stripe.com/invoice/acct/in_adapter_123/pdf',
      payment_intent: {
        latest_charge: {
          id: 'ch_adapter_123',
          receipt_url: 'https://pay.stripe.com/receipts/ch_adapter_123',
          payment_method_details: {
            card: {
              last4: '4242',
            },
          },
        },
      },
    });

    expect(summary).toEqual({
      id: 'in_adapter_123',
      customerId: 'cus_adapter_123',
      subscriptionId: 'sub_adapter_123',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_adapter_123',
      invoicePdfUrl: 'https://pay.stripe.com/invoice/acct/in_adapter_123/pdf',
    });
    expect(JSON.stringify(summary)).not.toContain('4242');
    expect(JSON.stringify(summary)).not.toContain('receipt_url');
  });

  it('normalizes receipt links separately from downloadable invoice PDFs', () => {
    const summary = readStripeChargeReceiptDocumentSummary({
      id: 'ch_adapter_123',
      customer: 'cus_adapter_123',
      receipt_url: 'https://pay.stripe.com/receipts/ch_adapter_123',
      invoice_pdf: 'https://pay.stripe.com/not-a-receipt.pdf',
    });

    expect(summary).toEqual({
      id: 'ch_adapter_123',
      customerId: 'cus_adapter_123',
      receiptUrl: 'https://pay.stripe.com/receipts/ch_adapter_123',
    });
  });

  it('keeps optional provider document URLs nullable for unavailable or expired links', () => {
    expect(
      readStripeInvoiceDocumentSummary({
        id: 'in_without_links',
        customer: null,
        subscription: null,
        hosted_invoice_url: null,
        invoice_pdf: null,
      }),
    ).toEqual({
      id: 'in_without_links',
      customerId: null,
      subscriptionId: null,
      hostedInvoiceUrl: null,
      invoicePdfUrl: null,
    });

    expect(
      readStripeChargeReceiptDocumentSummary({
        id: 'ch_without_receipt',
        customer: null,
        receipt_url: null,
      }),
    ).toEqual({
      id: 'ch_without_receipt',
      customerId: null,
      receiptUrl: null,
    });
  });
});
