import { describe, expect, it } from 'vitest';
import type { AuthRuntimeDatabase } from '../auth-runtime.js';
import type { OrganizationClassroomAccess } from '../booking/authorization.js';
import { resolveBusinessFacts } from './business-facts.js';

const buildAccess = ({
  orgRole = 'owner',
  canManageBookings = true,
  canManageParticipants = true,
  canUseParticipantBooking = false,
}: {
  orgRole?: 'owner' | 'admin' | 'member' | null;
  canManageBookings?: boolean;
  canManageParticipants?: boolean;
  canUseParticipantBooking?: boolean;
} = {}): OrganizationClassroomAccess => ({
  organizationId: 'org-a',
  organizationSlug: 'org-a',
  organizationName: 'Org A',
  classroomId: 'class-a',
  classroomSlug: 'class-a',
  classroomName: 'Class A',
  facts: {
    orgRole,
    classroomStaffRole: null,
    hasParticipantRecord: canUseParticipantBooking,
  },
  effective: {
    canManageOrganization: orgRole === 'owner' || orgRole === 'admin',
    canManageClassroom: orgRole === 'owner' || orgRole === 'admin',
    canManageBookings,
    canManageParticipants,
    canUseParticipantBooking,
  },
  sources: {
    canManageOrganization: orgRole === 'owner' || orgRole === 'admin' ? 'org_role' : null,
    canManageClassroom: orgRole === 'owner' || orgRole === 'admin' ? 'org_role' : null,
    canManageBookings: orgRole === 'owner' || orgRole === 'admin' ? 'org_role' : null,
    canManageParticipants: orgRole === 'owner' || orgRole === 'admin' ? 'org_role' : null,
    canUseParticipantBooking: canUseParticipantBooking ? 'participant_record' : null,
  },
  display: {
    primaryRole: orgRole === 'owner' || orgRole === 'admin' ? orgRole : 'participant',
    badges: [],
  },
});

const createDatabase = (results: unknown[][]) => {
  let index = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => {
          const result = results[index++] ?? [];
          return {
            then: (resolve: (value: unknown[]) => unknown) => resolve(result),
            limit: async () => result,
          };
        },
      }),
    }),
  } as unknown as AuthRuntimeDatabase;
};

describe('AI business facts', () => {
  it('returns operational counts and owner-safe billing summary for owners', async () => {
    const database = createDatabase([
      [{ count: 2 }],
      [{ count: 3 }],
      [{ count: 4 }],
      [{ count: 5 }],
      [
        {
          planCode: 'premium',
          subscriptionStatus: 'active',
          billingInterval: 'month',
          paymentIssueStartedAt: null,
          pastDueGraceEndsAt: null,
          billingProfileReadiness: 'ready',
          billingProfileNextAction: null,
        },
      ],
    ]);

    const facts = await resolveBusinessFacts({
      database,
      access: buildAccess({ orgRole: 'owner' }),
    });

    expect(facts.factKeys).toEqual([
      'service_count',
      'participant_count',
      'ticket_type_count',
      'invitation_count',
      'billing_summary',
    ]);
    expect(facts.lines).toEqual(
      expect.arrayContaining([
        '対象classroomのサービス数: 2',
        '対象classroomの参加者数: 3',
        '対象classroomのチケット種別数: 4',
        '対象classroomの招待数: 5',
        '課金プラン: premium',
        '契約状態: active',
      ]),
    );
    expect(facts.sensitive).toBe(true);
  });

  it('redacts billing details for non-owner users while keeping participant-safe facts', async () => {
    const database = createDatabase([
      [{ count: 1 }],
      [{ count: 1 }],
      [{ count: 0 }],
      [{ count: 0 }],
      [
        {
          planCode: 'premium',
          subscriptionStatus: 'past_due',
          billingInterval: 'month',
          paymentIssueStartedAt: new Date('2026-05-01T00:00:00.000Z'),
          pastDueGraceEndsAt: new Date('2026-05-08T00:00:00.000Z'),
          billingProfileReadiness: 'requires_action',
          billingProfileNextAction: 'add_payment_method',
        },
      ],
    ]);

    const facts = await resolveBusinessFacts({
      database,
      access: buildAccess({
        orgRole: null,
        canManageBookings: false,
        canManageParticipants: false,
        canUseParticipantBooking: true,
      }),
    });

    expect(facts.factKeys).toContain('billing_summary_redacted');
    expect(facts.lines).toContain(
      '課金情報: ownerのみ詳細を確認できます。ownerへ確認してください。',
    );
    expect(facts.lines.join('\n')).not.toContain('past_due');
    expect(facts.lines.join('\n')).not.toContain('add_payment_method');
    expect(facts.sensitive).toBe(true);
  });
});
