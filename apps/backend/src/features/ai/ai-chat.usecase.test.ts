import { describe, expect, it, vi } from 'vitest';
import type { OrganizationClassroomAccess } from '../../domain/booking/authorization.js';
import type { AiRequestContext } from './context-resolver.js';
import type { BusinessFactSummary, RetrievedKnowledgeContext } from './prompt.js';
import type { GeneratedAiAnswer } from './answer-generator.js';
import type { AiRouteContext } from './ai-route-context.js';
import { askAiChat } from './ai-chat.usecase.js';
import type { RetrievedKnowledgeChunk } from './retriever.js';

const buildAccess = (): OrganizationClassroomAccess => ({
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
});

const access = buildAccess();
const requestContext: AiRequestContext = {
  identity: {
    userId: 'user-a',
    email: 'owner@example.com',
    activeOrganizationId: 'org-a',
  },
  access,
  allowedVisibilities: ['public', 'authenticated', 'owner'],
  internalOperator: false,
  currentPage: '/admin/bookings',
};

const businessFacts: BusinessFactSummary = {
  factKeys: ['service_count'],
  lines: ['対象classroomのサービス数: 2'],
  sensitive: false,
};

const generatedAnswer = ({
  sources = [],
  suggestedActions = [],
  generationStatus = 'generated',
}: {
  sources?: GeneratedAiAnswer['sources'];
  suggestedActions?: GeneratedAiAnswer['suggestedActions'];
  generationStatus?: GeneratedAiAnswer['generationStatus'];
} = {}): GeneratedAiAnswer => ({
  answer: '予約運用から作成できます。',
  sources,
  suggestedActions,
  confidence: 82,
  needsHumanSupport: false,
  provider: 'cloudflare-workers-ai',
  model: '@cf/test/chat',
  inputTokens: 12,
  outputTokens: 34,
  latencyMs: 12,
  generationStatus,
  errorCode: generationStatus === 'generated' ? null : 'retrieval_failed',
  errorSummary: null,
  aiGatewayLogId: '01JADMCQQQBWH3NXZ5GCRN98DP',
});

const retrievedChunk = (
  overrides: Partial<RetrievedKnowledgeChunk> = {},
): RetrievedKnowledgeChunk => ({
  id: 'chunk-a',
  content: '予約枠は予約運用から作成します。',
  contentHash: 'hash-a',
  title: '予約運用',
  sourceKind: 'docs',
  sourcePath: '/manuals/bookings',
  chunkId: 'chunk-a',
  visibility: 'authenticated',
  score: 0.91,
  ...overrides,
});

const createConversationStore = (
  overrides: Partial<AiRouteContext['conversationStore']> = {},
): AiRouteContext['conversationStore'] =>
  ({
    ensureConversation: vi.fn(async () => ({
      conversationId: 'conversation-a',
      created: true,
    })),
    insertMessage: vi.fn(async (input: { role: 'user' | 'assistant'; conversationId: string }) => ({
      id: input.role === 'assistant' ? 'assistant-message-a' : 'user-message-a',
      conversationId: input.conversationId,
    })),
    canUserAccessAssistantMessage: vi.fn(),
    submitFeedback: vi.fn(),
    cleanupExpiredConversationContent: vi.fn(),
    countMessagesForConversation: vi.fn(),
    recordUsageEvent: vi.fn(),
    ...overrides,
  }) as AiRouteContext['conversationStore'];

const createContext = (overrides: Partial<AiRouteContext> = {}): AiRouteContext => ({
  auth: {} as never,
  database: {} as never,
  env: {},
  resolveRequestContext: vi.fn(async () => requestContext),
  conversationStore: createConversationStore(),
  observabilityStore: {
    listKnowledgeStatuses: vi.fn(),
    listFeedbackThemes: vi.fn(),
  },
  retrieveKnowledge: vi.fn(async () => []),
  resolveBusinessFacts: vi.fn(async () => businessFacts),
  generateAnswer: vi.fn(async () => generatedAnswer()),
  checkAndIncrementUsage: vi.fn(async () => ({
    allowed: true,
    userRemainingThisHour: 19,
    organizationRemainingToday: 199,
  })),
  sanitizeSourceReference: vi.fn(({ source }) => source),
  ensureInternalOperator: vi.fn(async () => ({ status: 200 })),
  recordChatBreadcrumb: vi.fn(),
  ...overrides,
});

describe('askAiChat', () => {
  it('returns 429 before creating a conversation when rate limit is exhausted', async () => {
    const ensureConversation = vi.fn();
    const ctx = createContext({
      conversationStore: createConversationStore({ ensureConversation }),
      checkAndIncrementUsage: vi.fn(async () => ({
        allowed: false,
        scopeKind: 'user',
        retryAfterSeconds: 600,
        userRemainingThisHour: 0,
        organizationRemainingToday: 199,
      })),
    });

    await expect(
      askAiChat({
        ctx,
        body: {
          message: '予約枠を作るには？',
        },
        headers: new Headers(),
      }),
    ).resolves.toEqual({
      status: 429,
      body: {
        message: 'AIチャットの利用上限に達しました。時間をおいて再試行してください。',
        retryAfterSeconds: 600,
      },
    });
    expect(ensureConversation).not.toHaveBeenCalled();
  });

  it('returns 403 when a requested conversation is outside the current scope', async () => {
    const insertMessage = vi.fn();
    const retrieveKnowledge = vi.fn();
    const ctx = createContext({
      conversationStore: createConversationStore({
        ensureConversation: vi.fn(async () => null),
        insertMessage,
      }),
      retrieveKnowledge,
    });

    await expect(
      askAiChat({
        ctx,
        body: {
          message: '前の会話を続けて',
          conversationId: 'conversation-other',
        },
        headers: new Headers(),
      }),
    ).resolves.toEqual({
      status: 403,
      body: {
        message: 'Conversation scope is not permitted.',
      },
    });
    expect(insertMessage).not.toHaveBeenCalled();
    expect(retrieveKnowledge).not.toHaveBeenCalled();
  });

  it('keeps the conversation and stores fallback metadata when retrieval fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const insertMessage = vi.fn(
      async (input: { role: 'user' | 'assistant'; conversationId: string }) => ({
        id: input.role === 'assistant' ? 'assistant-message-a' : 'user-message-a',
        conversationId: input.conversationId,
      }),
    );
    const generateAnswer = vi.fn(async () =>
      generatedAnswer({
        sources: [
          {
            sourceKind: 'docs',
            title: '予約運用',
            sourcePath: '/manuals/bookings',
            chunkId: 'chunk-a',
            visibility: 'authenticated',
          },
        ],
        suggestedActions: [{ label: 'サポートへ相談する', actionKind: 'contact_support' }],
        generationStatus: 'fallback_retrieval_failed',
      }),
    );
    const ctx = createContext({
      conversationStore: createConversationStore({ insertMessage }),
      retrieveKnowledge: vi.fn(async () => {
        throw new Error('vector offline');
      }),
      generateAnswer,
    });

    const result = await askAiChat({
      ctx,
      body: {
        message: '予約枠を作るには？',
      },
      headers: new Headers(),
      startedAt: 100,
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      conversationId: 'conversation-a',
      messageId: 'assistant-message-a',
      sources: [{ title: '予約運用', chunkId: 'chunk-a' }],
      suggestedActions: [{ actionKind: 'contact_support' }],
    });
    expect(insertMessage).toHaveBeenCalledTimes(2);
    expect(insertMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        role: 'assistant',
        retrievedContext: expect.objectContaining({
          chunks: [],
          businessFactKeys: ['service_count'],
          retrievalErrorSummary: 'vector offline',
        }),
        provider: 'cloudflare-workers-ai',
        model: '@cf/test/chat',
        inputTokens: 12,
        outputTokens: 34,
        generationStatus: 'fallback_retrieval_failed',
        errorCode: 'retrieval_failed',
      }),
    );
    expect(ctx.conversationStore.recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: {
          userId: 'user-a',
          organizationId: 'org-a',
          classroomId: 'class-a',
        },
        conversationId: 'conversation-a',
        messageId: 'assistant-message-a',
        provider: 'cloudflare-workers-ai',
        model: '@cf/test/chat',
        inputTokens: 12,
        outputTokens: 34,
        generationStatus: 'fallback_retrieval_failed',
        errorCode: 'retrieval_failed',
      }),
    );
    expect(generateAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalErrorSummary: 'vector offline',
      }),
    );
    expect(ctx.recordChatBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalErrorSummary: 'vector offline',
      }),
    );
    warn.mockRestore();
  });

  it('returns only sanitized sources in the response and stored assistant message', async () => {
    const insertMessage = vi.fn(
      async (input: { role: 'user' | 'assistant'; conversationId: string }) => ({
        id: input.role === 'assistant' ? 'assistant-message-a' : 'user-message-a',
        conversationId: input.conversationId,
      }),
    );
    const publicSource: RetrievedKnowledgeContext = {
      sourceKind: 'docs',
      title: '予約運用',
      sourcePath: '/manuals/bookings',
      chunkId: 'chunk-a',
      visibility: 'authenticated',
      content: '予約枠は予約運用から作成します。',
    };
    const internalSource: GeneratedAiAnswer['sources'][number] = {
      sourceKind: 'specs',
      title: '内部仕様',
      sourcePath: '/specs/004-ai-chatbot',
      chunkId: 'chunk-b',
      visibility: 'owner',
      internalOnly: true,
    };
    const ctx = createContext({
      conversationStore: createConversationStore({ insertMessage }),
      retrieveKnowledge: vi.fn(async () => [retrievedChunk(publicSource)]),
      generateAnswer: vi.fn(async () =>
        generatedAnswer({
          sources: [publicSource, internalSource],
          suggestedActions: [
            { label: '予約運用を開く', href: '/admin/bookings', actionKind: 'open_page' },
          ],
        }),
      ),
      sanitizeSourceReference: vi.fn(({ source }) =>
        source.sourceKind === 'docs'
          ? {
              sourceKind: source.sourceKind,
              title: source.title,
              sourcePath: source.sourcePath ?? null,
              chunkId: source.chunkId ?? null,
              visibility: source.visibility,
            }
          : null,
      ),
    });

    const result = await askAiChat({
      ctx,
      body: {
        message: '予約枠を作るには？',
        organizationId: 'org-a',
        classroomId: 'class-a',
        currentPage: '/admin/bookings',
      },
      headers: new Headers(),
    });

    expect(result).toMatchObject({
      status: 200,
      body: {
        conversationId: 'conversation-a',
        messageId: 'assistant-message-a',
        answer: '予約運用から作成できます。',
        sources: [{ sourceKind: 'docs', title: '予約運用', chunkId: 'chunk-a' }],
        suggestedActions: [{ href: '/admin/bookings', actionKind: 'open_page' }],
        confidence: 82,
        needsHumanSupport: false,
        rateLimit: {
          userRemainingThisHour: 19,
          organizationRemainingToday: 199,
        },
      },
    });
    expect(insertMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sources: [
          {
            sourceKind: 'docs',
            title: '予約運用',
            sourcePath: '/manuals/bookings',
            chunkId: 'chunk-a',
            visibility: 'authenticated',
          },
        ],
      }),
    );
    expect(ctx.sanitizeSourceReference).toHaveBeenCalledTimes(2);
    expect(ctx.recordChatBreadcrumb).toHaveBeenCalledTimes(1);
    expect(ctx.conversationStore.recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: {
          userId: 'user-a',
          organizationId: 'org-a',
          classroomId: 'class-a',
        },
        messageId: 'assistant-message-a',
        generationStatus: 'generated',
        errorCode: null,
      }),
    );
  });
});
