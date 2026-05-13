import { describe, expect, it } from 'vitest';
import type { OrganizationClassroomAccess } from '../booking/authorization.js';
import {
  buildAiSystemPrompt,
  buildAnswerPrompt,
  redactSensitiveText,
  shouldSkipAiGatewayCache,
} from './prompt.js';

const access: OrganizationClassroomAccess = {
  organizationId: 'org-a',
  organizationSlug: 'org-a',
  organizationName: 'Org A',
  classroomId: 'class-a',
  classroomSlug: 'class-a',
  classroomName: 'Class A',
  facts: {
    orgRole: 'owner',
    classroomStaffRole: null,
    hasParticipantRecord: false,
  },
  effective: {
    canManageOrganization: true,
    canManageClassroom: true,
    canManageBookings: true,
    canManageParticipants: true,
    canUseParticipantBooking: false,
  },
  sources: {
    canManageOrganization: 'org_role',
    canManageClassroom: 'org_role',
    canManageBookings: 'org_role',
    canManageParticipants: 'org_role',
    canUseParticipantBooking: null,
  },
  display: {
    primaryRole: 'owner',
    badges: ['owner'],
  },
};

describe('AI prompt helpers', () => {
  it('keeps action execution and authority limits in the system prompt', () => {
    const prompt = buildAiSystemPrompt();

    expect(prompt).toContain('操作は実行せず');
    expect(prompt).toContain('ユーザーの権限外の情報');
    expect(prompt).toContain('根拠がない');
  });

  it('redacts secrets, card-like numbers, and billing URLs', () => {
    const redacted = redactSensitiveText(
      'sk_live_abc123\ncard 4242 4242 4242 4242\ninvoice https://billing.example.com/inv_1',
    );

    expect(redacted).toContain('[redacted-secret]');
    expect(redacted).toContain('[redacted-card-number]');
    expect(redacted).toContain('invoice [redacted-url]');
    expect(redacted).not.toContain('sk_live_abc123');
  });

  it('structures user context, retrieved docs, DB facts, and the question separately', () => {
    const prompt = buildAnswerPrompt({
      userId: 'user-a',
      access,
      currentPage: '/admin/bookings',
      retrievedContexts: [
        {
          sourceKind: 'docs',
          title: '予約運用',
          sourcePath: '/manuals/bookings',
          chunkId: 'chunk-a',
          visibility: 'authenticated',
          content: '予約枠は管理画面から作成します。',
        },
      ],
      businessFacts: {
        factKeys: ['service.count'],
        lines: ['serviceCount: 2'],
        sensitive: false,
      },
      message: '予約枠を作るには？',
    });

    expect(prompt).toContain('User context:');
    expect(prompt).toContain('Retrieved docs:');
    expect(prompt).toContain('DB facts:');
    expect(prompt).toContain('User question:');
    expect(prompt).toContain('serviceCount: 2');
  });

  it('skips AI Gateway cache for billing and sensitive fact prompts', () => {
    expect(shouldSkipAiGatewayCache('請求書はどこですか？', null)).toBe(true);
    expect(
      shouldSkipAiGatewayCache('予約枠を作るには？', {
        factKeys: ['billing.paymentMethodStatus'],
        lines: ['paymentMethodStatus: requires_action'],
        sensitive: true,
      }),
    ).toBe(true);
    expect(shouldSkipAiGatewayCache('予約枠を作るには？', null)).toBe(false);
  });
});
