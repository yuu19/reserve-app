import { describe, expect, it } from 'vitest';
import type { OrganizationStoreAccess } from '../../domain/booking/authorization.js';
import {
  buildAiSystemPrompt,
  buildAnswerPrompt,
  redactSensitiveText,
  shouldSkipAiGatewayCache,
} from './prompt.js';

const access: OrganizationStoreAccess = {
  organizationId: 'org-a',
  organizationSlug: 'org-a',
  organizationName: 'Org A',
  storeId: 'class-a',
  storeSlug: 'class-a',
  storeName: 'Class A',
  facts: {
    orgRole: 'owner',
    storeStaffRole: null,
    hasParticipantRecord: false,
  },
  effective: {
    canManageOrganization: true,
    canManageStore: true,
    canManageBookings: true,
    canManageParticipants: true,
    canUseParticipantBooking: false,
  },
  sources: {
    canManageOrganization: 'org_role',
    canManageStore: 'org_role',
    canManageBookings: 'org_role',
    canManageParticipants: 'org_role',
    canUseParticipantBooking: null,
  },
  display: {
    primaryRole: 'owner',
    badges: ['owner'],
  },
};

describe('AI プロンプトヘルパー', () => {
  it('システムプロンプトにアクション実行と権限の制限を保持する', () => {
    const prompt = buildAiSystemPrompt();

    expect(prompt).toContain('操作は実行せず');
    expect(prompt).toContain('ユーザーの権限外の情報');
    expect(prompt).toContain('根拠がない');
  });

  it('秘密情報・カード状の番号・課金 URL をマスクする', () => {
    const redacted = redactSensitiveText(
      'sk_live_abc123\ncard 4242 4242 4242 4242\ninvoice https://billing.example.com/inv_1',
    );

    expect(redacted).toContain('[redacted-secret]');
    expect(redacted).toContain('[redacted-card-number]');
    expect(redacted).toContain('invoice [redacted-url]');
    expect(redacted).not.toContain('sk_live_abc123');
  });

  it('ユーザーコンテキスト・取得文書・DB ファクト・質問を分けて構造化する', () => {
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

  it('課金と機密ファクトのプロンプトでは AI Gateway キャッシュをスキップする', () => {
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
