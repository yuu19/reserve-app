import { describe, expect, it } from 'vitest';
import {
  createBillingSubjectChangedEvent,
  resolveBillingEventDeliveryMode,
} from './billing-event-outbox.js';
import type * as dbSchema from './db/schema.js';

const subject = {
  id: 'subject-row-1',
  appId: 'reserve',
  subjectType: 'organization',
  subjectId: 'organization-1',
  partyId: 'party-1',
  status: 'active',
  displayName: '予約組織',
  billingEmail: 'owner@example.com',
  billingName: '予約組織',
  billingContactsJson: '[{"email":"owner@example.com"}]',
  metadataJson: '{}',
  eventRevision: 4,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
} satisfies typeof dbSchema.billingSubject.$inferSelect;

describe('billing event outbox', () => {
  it('Test Clock subject を本番配送から分離する', () => {
    expect(
      resolveBillingEventDeliveryMode({
        ...subject,
        metadataJson: '{"source":"billing-api-test-clock"}',
      }),
    ).toBe('test');
    expect(resolveBillingEventDeliveryMode(subject)).toBe('production');
  });

  it('subject 単位の次 revision と安全な請求識別情報だけをイベントへ含める', () => {
    const event = createBillingSubjectChangedEvent({
      subject,
      reason: 'stripe.invoice.payment_failed',
      affectedResources: ['subscription', 'invoice', 'subscription'],
      providerEventId: 'evt_1',
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
      invoiceEvent: {
        id: 'invoice-event-1',
        type: 'payment_failed',
        providerInvoiceId: 'in_1',
        providerPaymentIntentId: 'pi_1',
        providerStatus: 'open',
        occurredAt: new Date('2026-07-20T00:00:00.000Z'),
      },
      occurredAt: new Date('2026-07-20T00:00:00.000Z'),
    });

    expect(event).toMatchObject({
      schemaVersion: 1,
      eventType: 'billing.subject.changed.v1',
      appId: 'reserve',
      subject: { type: 'organization', id: 'organization-1', revision: 5 },
      reason: 'stripe.invoice.payment_failed',
      affectedResources: ['subscription', 'invoice'],
      provider: {
        name: 'stripe',
        eventId: 'evt_1',
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
      },
      invoiceEvent: {
        id: 'invoice-event-1',
        type: 'payment_failed',
        providerInvoiceId: 'in_1',
      },
    });
    expect(JSON.stringify(event)).not.toContain('owner@example.com');
  });
});
