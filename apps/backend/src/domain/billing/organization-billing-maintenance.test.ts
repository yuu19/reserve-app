import { describe, expect, it } from 'vitest';
import {
  isPastDueGraceReminderDue,
  resolvePastDueGraceReminderStripeEventId,
} from './organization-billing-maintenance.js';

describe('組織課金メンテナンス', () => {
  it('期限切れ 3 日前の期間にある past_due 猶予リマインダーを選択する', () => {
    const now = new Date('2026-05-01T00:00:00.000Z');

    expect(
      isPastDueGraceReminderDue({
        now,
        pastDueGraceEndsAt: new Date('2026-05-04T00:30:00.000Z'),
      }),
    ).toBe(true);
    expect(
      isPastDueGraceReminderDue({
        now,
        pastDueGraceEndsAt: new Date('2026-05-03T23:59:59.000Z'),
      }),
    ).toBe(false);
    expect(
      isPastDueGraceReminderDue({
        now,
        pastDueGraceEndsAt: new Date('2026-05-04T01:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('組織と猶予期限ごとに決定的なリマインド受領 ID を使う', () => {
    expect(
      resolvePastDueGraceReminderStripeEventId({
        organizationId: 'org-1',
        pastDueGraceEndsAt: new Date('2026-05-04T00:30:00.000Z'),
      }),
    ).toBe('scheduled_past_due_grace_reminder:org-1:1777854600000');
  });
});
