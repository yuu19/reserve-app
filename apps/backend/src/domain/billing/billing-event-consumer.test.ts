import type {
  BillingApiInvoiceEventsResponse,
  BillingSubjectChangedEvent,
} from '@repo/billing-types';
import { describe, expect, it } from 'vitest';
import {
  isBillingEventProcessingLeaseExpired,
  isBillingSubjectChangedEvent,
  isInvoicePaymentRecovered,
} from './billing-event-consumer.js';

const issueEvent: BillingSubjectChangedEvent = {
  schemaVersion: 1,
  eventId: 'event-1',
  eventType: 'billing.subject.changed.v1',
  appId: 'reserve',
  subject: { type: 'organization', id: 'organization-1', revision: 3 },
  reason: 'stripe.invoice.payment_failed',
  affectedResources: ['subscription', 'invoice'],
  occurredAt: '2026-07-20T00:00:00.000Z',
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
    providerPaymentIntentId: 'pi_1',
    providerStatus: 'open',
    occurredAt: '2026-07-20T00:00:00.000Z',
  },
};

const invoiceEvents = (
  events: BillingApiInvoiceEventsResponse['events'],
): BillingApiInvoiceEventsResponse => ({
  appId: 'reserve',
  subjectType: 'organization',
  subjectId: 'organization-1',
  events,
  limit: 100,
  hasMore: false,
  syncedAt: '2026-07-21T00:00:00.000Z',
});

describe('billing event consumer', () => {
  it('公開イベント契約を検証する', () => {
    expect(isBillingSubjectChangedEvent(issueEvent)).toBe(true);
    expect(isBillingSubjectChangedEvent({ ...issueEvent, schemaVersion: 2 })).toBe(false);
    expect(
      isBillingSubjectChangedEvent({
        ...issueEvent,
        subject: { ...issueEvent.subject, revision: 0 },
      }),
    ).toBe(false);
    expect(isBillingSubjectChangedEvent({ ...issueEvent, reason: 'unknown.reason' })).toBe(false);
    expect(
      isBillingSubjectChangedEvent({
        ...issueEvent,
        reason: 'stripe.subscription_schedule.updated',
        invoiceEvent: null,
      }),
    ).toBe(true);
  });

  it('期限切れまたは旧schemaの processing leaseを回収対象にする', () => {
    const timestamp = new Date('2026-07-26T00:05:00.000Z');

    expect(
      isBillingEventProcessingLeaseExpired({
        leaseExpiresAt: new Date('2026-07-26T00:04:59.000Z'),
        timestamp,
      }),
    ).toBe(true);
    expect(
      isBillingEventProcessingLeaseExpired({
        leaseExpiresAt: null,
        timestamp,
      }),
    ).toBe(true);
    expect(
      isBillingEventProcessingLeaseExpired({
        leaseExpiresAt: new Date('2026-07-26T00:05:01.000Z'),
        timestamp,
      }),
    ).toBe(false);
  });

  it('同じ invoice の後続支払い成功を復旧として扱う', () => {
    expect(
      isInvoicePaymentRecovered({
        event: issueEvent,
        invoiceEvents: invoiceEvents([
          {
            id: 'invoice-event-2',
            provider: 'stripe',
            providerEventId: 'evt_2',
            eventType: 'payment_succeeded',
            providerCustomerId: 'cus_1',
            providerSubscriptionId: 'sub_1',
            providerInvoiceId: 'in_1',
            providerPaymentIntentId: 'pi_1',
            providerStatus: 'paid',
            ownerFacingStatus: 'succeeded',
            hostedInvoiceUrl: null,
            invoicePdfUrl: null,
            occurredAt: '2026-07-20T00:05:00.000Z',
            createdAt: '2026-07-20T00:05:00.000Z',
            updatedAt: '2026-07-20T00:05:00.000Z',
          },
        ]),
      }),
    ).toBe(true);
  });

  it('別 invoice または失敗より古い成功は復旧として扱わない', () => {
    expect(
      isInvoicePaymentRecovered({
        event: issueEvent,
        invoiceEvents: invoiceEvents([
          {
            id: 'invoice-event-0',
            provider: 'stripe',
            providerEventId: 'evt_0',
            eventType: 'payment_succeeded',
            providerCustomerId: 'cus_1',
            providerSubscriptionId: 'sub_1',
            providerInvoiceId: 'in_other',
            providerPaymentIntentId: 'pi_0',
            providerStatus: 'paid',
            ownerFacingStatus: 'succeeded',
            hostedInvoiceUrl: null,
            invoicePdfUrl: null,
            occurredAt: '2026-07-19T23:00:00.000Z',
            createdAt: '2026-07-19T23:00:00.000Z',
            updatedAt: '2026-07-19T23:00:00.000Z',
          },
        ]),
      }),
    ).toBe(false);
  });
});
