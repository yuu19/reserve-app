import { describe, expect, it } from 'vitest';
import { resolveReserveAppPaymentIssueNotificationRecipientPlans } from './reserve-app-billing-notifications.js';

describe('組織課金の支払い問題通知計画', () => {
  const owners = [
    {
      userId: 'owner-sent',
      email: 'sent-owner@example.com',
      name: 'Sent Owner',
    },
    {
      userId: 'owner-failed',
      email: 'failed-owner@example.com',
      name: 'Failed Owner',
    },
    {
      userId: 'owner-new',
      email: 'new-owner@example.com',
      name: 'New Owner',
    },
  ];

  it('失敗した確認済みオーナー受信者だけを再試行し送信済み受信者をスキップする', () => {
    const plans = resolveReserveAppPaymentIssueNotificationRecipientPlans({
      owners,
      attempts: [
        {
          sequenceNumber: 1,
          recipientUserId: 'owner-sent',
          recipientEmail: 'sent-owner@example.com',
          deliveryState: 'requested',
          attemptNumber: 1,
        },
        {
          sequenceNumber: 2,
          recipientUserId: 'owner-sent',
          recipientEmail: 'sent-owner@example.com',
          deliveryState: 'sent',
          attemptNumber: 1,
        },
        {
          sequenceNumber: 3,
          recipientUserId: 'owner-failed',
          recipientEmail: 'failed-owner@example.com',
          deliveryState: 'requested',
          attemptNumber: 1,
        },
        {
          sequenceNumber: 4,
          recipientUserId: 'owner-failed',
          recipientEmail: 'failed-owner@example.com',
          deliveryState: 'failed',
          attemptNumber: 1,
        },
      ],
    });

    expect(plans).toEqual([
      expect.objectContaining({
        owner: owners[0],
        action: 'skip',
        deliveryState: 'skipped',
        attemptNumber: 2,
      }),
      expect.objectContaining({
        owner: owners[1],
        action: 'send',
        deliveryState: 'retried',
        attemptNumber: 2,
      }),
      expect.objectContaining({
        owner: owners[2],
        action: 'send',
        deliveryState: 'requested',
        attemptNumber: 1,
      }),
    ]);
  });
});
