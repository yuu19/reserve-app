import { describe, expect, it, vi } from 'vitest';
import type { OrganizationStoreAccess } from '../../domain/booking/authorization.js';
import { generateAnswer } from './answer-generator.js';

const buildAccess = ({
  role = 'participant',
  canManageBookings = false,
  canUseParticipantBooking = true,
}: {
  role?: 'owner' | 'admin' | 'participant';
  canManageBookings?: boolean;
  canUseParticipantBooking?: boolean;
} = {}): OrganizationStoreAccess => ({
  organizationId: 'org-a',
  organizationSlug: 'org-a',
  organizationName: 'Org A',
  storeId: 'class-a',
  storeSlug: 'class-a',
  storeName: 'Class A',
  facts: {
    orgRole: role === 'participant' ? null : role,
    storeStaffRole: null,
    hasParticipantRecord: role === 'participant',
  },
  effective: {
    canManageOrganization: role === 'owner' || role === 'admin',
    canManageStore: role === 'owner' || role === 'admin',
    canManageBookings,
    canManageParticipants: role === 'owner' || role === 'admin',
    canUseParticipantBooking,
  },
  sources: {
    canManageOrganization: role === 'owner' || role === 'admin' ? 'org_role' : null,
    canManageStore: role === 'owner' || role === 'admin' ? 'org_role' : null,
    canManageBookings: role === 'owner' || role === 'admin' ? 'org_role' : null,
    canManageParticipants: role === 'owner' || role === 'admin' ? 'org_role' : null,
    canUseParticipantBooking: role === 'participant' ? 'participant_record' : null,
  },
  display: {
    primaryRole: role,
    badges: [role],
  },
});

describe('AI 回答生成', () => {
  it('根拠がない場合は低信頼度フォールバックを返す', async () => {
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

  it('プロバイダー JSON を解析しソースを保持してドキュメント専用回答では AI Gateway キャッシュを使う', async () => {
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
        usage: {
          input_tokens: 11,
          output_tokens: 22,
        },
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
      provider: 'cloudflare-workers-ai',
      model: '@cf/test/chat',
      inputTokens: 11,
      outputTokens: 22,
      generationStatus: 'generated',
      errorCode: null,
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

  it('低信頼度のプロバイダー出力を人によるサポートが必要として扱う', async () => {
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

  it('回答生成前の検索失敗時は明確なフォールバックを返す', async () => {
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
      inputTokens: null,
      outputTokens: null,
      latencyMs: 0,
      generationStatus: 'fallback_retrieval_failed',
      errorCode: 'retrieval_failed',
      errorSummary: 'vectorize unavailable',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('内部パスでない AI 生成アクション href を除外する', async () => {
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

  it('根拠が業務ファクトのみの場合は db_summary ソースを含める', async () => {
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

  it('プロバイダー生成が失敗した場合はフォールバックを返す', async () => {
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

  it('機密性のある DB ファクトを含む場合は Gateway キャッシュをスキップする', async () => {
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
