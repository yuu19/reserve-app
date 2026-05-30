import { describe, expect, it } from 'vitest';
import {
  aiChatRequestSchema,
  aiChatResponseSchema,
  feedbackRequestSchema,
  feedbackResponseSchema,
  feedbackRoute,
  feedbackThemeSchema,
  chatRoute,
  internalFeedbackThemesRoute,
  internalKnowledgeRoute,
  knowledgeStatusSchema,
} from './ai.schemas.js';

const responseStatuses = (route: { responses: Record<string | number, unknown> }) =>
  Object.keys(route.responses)
    .map(Number)
    .sort((a, b) => a - b);

describe('AI ルート互換性', () => {
  it('公開チャットルートのメソッド・パス・ステータス・本文形状を安定させる', () => {
    expect(chatRoute.method).toBe('post');
    expect(chatRoute.path).toBe('/chat');
    expect(responseStatuses(chatRoute)).toEqual([200, 401, 403, 429]);

    expect(
      aiChatRequestSchema.parse({
        message: '  予約枠を作るには？  ',
        conversationId: 'conversation-a',
        organizationId: 'org-a',
        storeId: 'class-a',
        currentPage: '/admin/bookings',
      }),
    ).toMatchObject({
      message: '予約枠を作るには？',
      conversationId: 'conversation-a',
      organizationId: 'org-a',
      storeId: 'class-a',
      currentPage: '/admin/bookings',
    });
    expect(() => aiChatRequestSchema.parse({ message: '' })).toThrow();

    expect(
      aiChatResponseSchema.parse({
        conversationId: 'conversation-a',
        messageId: 'message-a',
        answer: '予約運用から作成できます。',
        sources: [
          {
            sourceKind: 'docs',
            title: '予約運用',
            sourcePath: '/manuals/bookings',
            chunkId: 'chunk-a',
            visibility: 'authenticated',
          },
        ],
        suggestedActions: [
          {
            label: '予約運用を開く',
            href: '/admin/bookings',
            actionKind: 'open_page',
          },
        ],
        confidence: 82,
        needsHumanSupport: false,
        rateLimit: {
          userRemainingThisHour: 19,
          organizationRemainingToday: 199,
        },
      }),
    ).toMatchObject({
      conversationId: 'conversation-a',
      messageId: 'message-a',
      confidence: 82,
      needsHumanSupport: false,
    });
  });

  it('フィードバックルートのメソッド・パス・ステータス・本文形状を安定させる', () => {
    expect(feedbackRoute.method).toBe('post');
    expect(feedbackRoute.path).toBe('/messages/{messageId}/feedback');
    expect(responseStatuses(feedbackRoute)).toEqual([200, 401, 403]);

    expect(feedbackRoute.request.params.parse({ messageId: 'message-a' })).toEqual({
      messageId: 'message-a',
    });
    expect(feedbackRequestSchema.parse({ rating: 'unhelpful', comment: 'もっと詳しく' })).toEqual({
      rating: 'unhelpful',
      comment: 'もっと詳しく',
    });
    expect(
      feedbackResponseSchema.parse({
        feedbackId: 'feedback-a',
        messageId: 'message-a',
        rating: 'helpful',
      }),
    ).toEqual({
      feedbackId: 'feedback-a',
      messageId: 'message-a',
      rating: 'helpful',
    });
  });

  it('内部調査ルートのパス・ステータス・レスポンス項目形状を安定させる', () => {
    expect(internalKnowledgeRoute.method).toBe('get');
    expect(internalKnowledgeRoute.path).toBe('/knowledge');
    expect(responseStatuses(internalKnowledgeRoute)).toEqual([200, 401, 403]);
    expect(
      knowledgeStatusSchema.parse({
        documentId: 'document-a',
        sourceKind: 'docs',
        title: '予約運用',
        sourcePath: '/manuals/bookings',
        locale: 'ja',
        visibility: 'owner',
        internalOnly: false,
        indexStatus: 'indexed',
        indexedAt: '2026-05-13T00:00:00.000Z',
        lastError: null,
      }),
    ).toMatchObject({
      documentId: 'document-a',
      indexStatus: 'indexed',
    });

    expect(internalFeedbackThemesRoute.method).toBe('get');
    expect(internalFeedbackThemesRoute.path).toBe('/feedback-themes');
    expect(responseStatuses(internalFeedbackThemesRoute)).toEqual([200, 401, 403]);
    expect(
      feedbackThemeSchema.parse({
        theme: '回答が古い',
        count: 2,
        latestAt: '2026-05-13T00:00:00.000Z',
      }),
    ).toEqual({
      theme: '回答が古い',
      count: 2,
      latestAt: '2026-05-13T00:00:00.000Z',
    });
  });
});
