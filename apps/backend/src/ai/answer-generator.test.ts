import { describe, expect, it, vi } from 'vitest';
import type { OrganizationClassroomAccess } from '../booking/authorization.js';
import { generateAnswer } from './answer-generator.js';

const buildAccess = ({
  role = 'participant',
  canManageBookings = false,
  canUseParticipantBooking = true,
}: {
  role?: 'owner' | 'admin' | 'participant';
  canManageBookings?: boolean;
  canUseParticipantBooking?: boolean;
} = {}): OrganizationClassroomAccess => ({
  organizationId: 'org-a',
  organizationSlug: 'org-a',
  organizationName: 'Org A',
  classroomId: 'class-a',
  classroomSlug: 'class-a',
  classroomName: 'Class A',
  facts: {
    orgRole: role === 'participant' ? null : role,
    classroomStaffRole: null,
    hasParticipantRecord: role === 'participant',
  },
  effective: {
    canManageOrganization: role === 'owner' || role === 'admin',
    canManageClassroom: role === 'owner' || role === 'admin',
    canManageBookings,
    canManageParticipants: role === 'owner' || role === 'admin',
    canUseParticipantBooking,
  },
  sources: {
    canManageOrganization: role === 'owner' || role === 'admin' ? 'org_role' : null,
    canManageClassroom: role === 'owner' || role === 'admin' ? 'org_role' : null,
    canManageBookings: role === 'owner' || role === 'admin' ? 'org_role' : null,
    canManageParticipants: role === 'owner' || role === 'admin' ? 'org_role' : null,
    canUseParticipantBooking: role === 'participant' ? 'participant_record' : null,
  },
  display: {
    primaryRole: role,
    badges: [role],
  },
});

describe('AI answer generation', () => {
  it('returns a low-confidence fallback when no grounding is available', async () => {
    await expect(
      generateAnswer({
        env: {},
        userId: 'user-a',
        access: buildAccess(),
        message: '未知の設定を変更して',
        retrievedContexts: [],
        businessFacts: null,
      }),
    ).resolves.toMatchObject({
      confidence: 20,
      needsHumanSupport: true,
      sources: [],
      suggestedActions: [{ actionKind: 'contact_owner' }],
    });
  });

  it('parses provider JSON, preserves sources, and uses AI Gateway cache for docs-only answers', async () => {
    const ai = {
      aiGatewayLogId: '01JADMCQQQBWH3NXZ5GCRN98DP',
      run: vi.fn(async () => ({
        response: JSON.stringify({
          answer: '予約運用から予約枠を作成できます。',
          confidence: 82,
          needsHumanSupport: false,
          suggestedActions: [
            { label: '予約運用を開く', href: '/admin/bookings', actionKind: 'open_page' },
          ],
        }),
      })),
    };

    const result = await generateAnswer({
      env: {
        AI: ai,
        AI_ANSWER_MODEL: '@cf/test/chat',
        AI_GATEWAY_ID: 'reserve-app-ai',
      },
      userId: 'user-a',
      access: buildAccess({ role: 'admin', canManageBookings: true }),
      currentPage: '/admin/dashboard',
      message: '予約枠を作るには？',
      retrievedContexts: [
        {
          sourceKind: 'docs',
          title: '予約運用',
          sourcePath: '/manuals/bookings',
          chunkId: 'chunk-a',
          visibility: 'authenticated',
          content: '予約枠は予約運用から作成します。',
        },
      ],
      businessFacts: null,
    });

    expect(result).toMatchObject({
      answer: '予約運用から予約枠を作成できます。',
      confidence: 82,
      needsHumanSupport: false,
      model: '@cf/test/chat',
      generationStatus: 'generated',
      errorSummary: null,
      aiGatewayLogId: '01JADMCQQQBWH3NXZ5GCRN98DP',
      sources: [{ title: '予約運用', chunkId: 'chunk-a' }],
      suggestedActions: [{ label: '予約運用を開く', href: '/admin/bookings' }],
    });
    expect(result.latencyMs).toEqual(expect.any(Number));
    expect(ai.run).toHaveBeenCalledWith(
      '@cf/test/chat',
      expect.objectContaining({ messages: expect.any(Array) }),
      expect.objectContaining({
        gateway: expect.objectContaining({
          id: 'reserve-app-ai',
          skipCache: false,
          cacheTtl: 60,
        }),
      }),
    );
  });

  it('marks low-confidence provider output as requiring human support', async () => {
    const run = vi.fn(async () => ({
      response: JSON.stringify({
        answer: '断定できません。',
        confidence: 44,
        suggestedActions: [],
      }),
    }));

    await expect(
      generateAnswer({
        env: { AI: { run } },
        userId: 'user-a',
        access: buildAccess(),
        message: 'チケットが使えません',
        retrievedContexts: [
          {
            sourceKind: 'faq',
            title: 'チケットFAQ',
            chunkId: 'chunk-ticket',
            visibility: 'participant',
            content: '残数がある場合も対象サービスに制限があることがあります。',
          },
        ],
        businessFacts: null,
      }),
    ).resolves.toMatchObject({
      confidence: 44,
      needsHumanSupport: true,
      suggestedActions: [{ actionKind: 'contact_owner' }],
    });
  });

  it('returns a clear fallback when retrieval failed before answer generation', async () => {
    const run = vi.fn();

    await expect(
      generateAnswer({
        env: { AI: { run }, AI_ANSWER_MODEL: '@cf/test/chat' },
        userId: 'user-a',
        access: buildAccess({ role: 'admin', canManageBookings: true }),
        message: '予約枠を作るには？',
        retrievedContexts: [],
        businessFacts: {
          factKeys: ['serviceCount'],
          lines: ['serviceCount: 1'],
          sensitive: false,
        },
        retrievalErrorSummary: 'vectorize unavailable',
      }),
    ).resolves.toMatchObject({
      confidence: 30,
      needsHumanSupport: true,
      model: '@cf/test/chat',
      latencyMs: 0,
      generationStatus: 'fallback_retrieval_failed',
      errorSummary: 'vectorize unavailable',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('drops AI-generated action hrefs that are not internal paths', async () => {
    const run = vi.fn(async () => ({
      response: JSON.stringify({
        answer: '該当画面を確認してください。',
        confidence: 75,
        needsHumanSupport: false,
        suggestedActions: [
          { label: '予約運用を開く', href: '/admin/bookings?tab=slots', actionKind: 'open_page' },
          { label: '外部へ移動', href: 'https://example.com/phishing', actionKind: 'open_page' },
          { label: 'スクリプト', href: 'javascript:alert(1)', actionKind: 'open_page' },
          { label: 'プロトコル相対', href: '//example.com/path', actionKind: 'open_page' },
        ],
      }),
    }));

    const result = await generateAnswer({
      env: { AI: { run } },
      userId: 'user-a',
      access: buildAccess({ role: 'admin', canManageBookings: true }),
      message: '予約枠を作るには？',
      retrievedContexts: [
        {
          sourceKind: 'docs',
          title: '予約運用',
          chunkId: 'chunk-bookings',
          visibility: 'authenticated',
          content: '予約枠は予約運用から作成します。',
        },
      ],
      businessFacts: null,
    });

    expect(result.suggestedActions).toEqual([
      { label: '予約運用を開く', href: '/admin/bookings?tab=slots', actionKind: 'open_page' },
      { label: '外部へ移動', href: null, actionKind: 'open_page' },
      { label: 'スクリプト', href: null, actionKind: 'open_page' },
      { label: 'プロトコル相対', href: null, actionKind: 'open_page' },
    ]);
  });

  it('includes a db_summary source when grounding comes only from business facts', async () => {
    await expect(
      generateAnswer({
        env: {},
        userId: 'owner-a',
        access: buildAccess({ role: 'owner', canManageBookings: true }),
        message: '支払い状態を確認したい',
        retrievedContexts: [],
        businessFacts: {
          factKeys: ['billing.status', 'billing.paymentMethodStatus'],
          lines: ['billingStatus: active', 'paymentMethodStatus: available'],
          sensitive: true,
        },
      }),
    ).resolves.toMatchObject({
      confidence: 45,
      generationStatus: 'fallback_ai_unavailable',
      sources: [
        {
          sourceKind: 'db_summary',
          title: '現在の業務データ',
          chunkId: 'billing.status,billing.paymentMethodStatus',
          visibility: 'authenticated',
        },
      ],
    });
  });

  it('returns a fallback when provider generation fails', async () => {
    const run = vi.fn(async () => {
      throw new Error('gateway not found');
    });

    await expect(
      generateAnswer({
        env: {
          AI: { run },
          AI_GATEWAY_ID: 'reserve-app-ai',
        },
        userId: 'user-a',
        access: buildAccess({ role: 'admin', canManageBookings: true }),
        message: '予約枠を作るには？',
        retrievedContexts: [
          {
            sourceKind: 'docs',
            title: '予約運用',
            chunkId: 'chunk-bookings',
            visibility: 'authenticated',
            content: '予約枠は予約運用から作成します。',
          },
        ],
        businessFacts: null,
      }),
    ).resolves.toMatchObject({
      confidence: 35,
      needsHumanSupport: true,
      sources: [{ title: '予約運用', chunkId: 'chunk-bookings' }],
      suggestedActions: [{ actionKind: 'contact_owner' }],
    });
  });

  it('skips gateway cache when sensitive DB facts are included', async () => {
    const run = vi.fn(async () => ({ response: '支払い状態は管理画面で確認してください。' }));

    await generateAnswer({
      env: {
        AI: { run },
        AI_GATEWAY_ID: 'reserve-app-ai',
      },
      userId: 'owner-a',
      access: buildAccess({ role: 'owner', canManageBookings: true }),
      message: '支払い方法を確認したい',
      retrievedContexts: [
        {
          sourceKind: 'docs',
          title: '契約',
          chunkId: 'chunk-billing',
          visibility: 'owner',
          content: '支払い方法は契約画面で確認します。',
        },
      ],
      businessFacts: {
        factKeys: ['billing.paymentMethodStatus'],
        lines: ['paymentMethodStatus: requires_action'],
        sensitive: true,
      },
    });

    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        gateway: expect.objectContaining({
          skipCache: true,
          cacheTtl: undefined,
        }),
      }),
    );
  });
});
