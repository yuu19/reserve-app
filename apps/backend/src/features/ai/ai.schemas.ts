import { createRoute, z } from '@hono/zod-openapi';
import {
  AI_FEEDBACK_RATINGS,
  AI_SOURCE_KINDS,
  AI_SOURCE_VISIBILITIES,
  AI_SUGGESTED_ACTION_KINDS,
} from '@repo/saas-chatbot-core';

/** AI 回答の根拠種別を API response と OpenAPI に公開する schema。 */
export const aiSourceKindSchema = z.enum(AI_SOURCE_KINDS);

/** AI ナレッジの公開範囲を API response と OpenAPI に公開する schema。 */
export const aiSourceVisibilitySchema = z.enum(AI_SOURCE_VISIBILITIES);

/** AI 回答に添える次アクション候補の表示文言、遷移先、種別を表す schema。 */
export const aiSuggestedActionSchema = z.object({
  label: z.string(),
  href: z.string().nullable().optional(),
  actionKind: z.enum(AI_SUGGESTED_ACTION_KINDS),
});

/** ログインユーザーが AI チャットへ送る質問と画面文脈を検証する schema。 */
export const aiChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().optional(),
  organizationId: z.string().optional(),
  storeId: z.string().optional(),
  currentPage: z.string().max(2048).optional(),
});

/** 認可後にユーザーへ返せる AI 回答の根拠参照だけを表す schema。 */
export const aiSourceReferenceSchema = z.object({
  sourceKind: aiSourceKindSchema,
  title: z.string(),
  sourcePath: z.string().nullable().optional(),
  chunkId: z.string().nullable().optional(),
  visibility: aiSourceVisibilitySchema.optional(),
});

/** AI チャット回答、根拠、提案アクション、rate limit 残量を返す response schema。 */
export const aiChatResponseSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
  answer: z.string(),
  sources: z.array(aiSourceReferenceSchema),
  suggestedActions: z.array(aiSuggestedActionSchema),
  confidence: z.number().int().min(0).max(100),
  needsHumanSupport: z.boolean(),
  rateLimit: z.object({
    userRemainingThisHour: z.number().int().min(0),
    organizationRemainingToday: z.number().int().min(0),
  }),
});

/** AI メッセージへの評価と任意コメントを受け取る feedback request schema。 */
export const feedbackRequestSchema = z.object({
  rating: z.enum(AI_FEEDBACK_RATINGS),
  comment: z.string().max(1000).optional(),
});

/** 受理済み feedback の識別子と評価を返す response schema。 */
export const feedbackResponseSchema = z.object({
  feedbackId: z.string(),
  messageId: z.string(),
  rating: z.enum(AI_FEEDBACK_RATINGS),
});

/** 内部運用者向けに AI ナレッジ文書の索引状態を一覧表示する schema。 */
export const knowledgeStatusSchema = z.object({
  documentId: z.string(),
  sourceKind: aiSourceKindSchema,
  title: z.string(),
  sourcePath: z.string(),
  locale: z.enum(['ja', 'en']),
  visibility: aiSourceVisibilitySchema,
  internalOnly: z.boolean(),
  indexStatus: z.enum(['pending', 'indexed', 'failed', 'stale', 'deleted']),
  indexedAt: z.string().nullable(),
  lastError: z.string().nullable(),
});

/** 低評価 feedback の確認で使うテーマ集約結果を表す schema。 */
export const feedbackThemeSchema = z.object({
  theme: z.string(),
  count: z.number().int().min(0),
  latestAt: z.string().nullable(),
});

/** 認証済みユーザーが AI チャットへ質問する OpenAPI route 定義。 */
export const chatRoute = createRoute({
  method: 'post',
  path: '/chat',
  tags: ['AI'],
  summary: 'Ask AI assistant',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: aiChatRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'AI answer',
      content: {
        'application/json': {
          schema: aiChatResponseSchema,
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    429: { description: 'Rate limited' },
  },
});

/** AI の回答メッセージに評価を送信する OpenAPI route 定義。 */
export const feedbackRoute = createRoute({
  method: 'post',
  path: '/messages/{messageId}/feedback',
  tags: ['AI'],
  summary: 'Submit AI answer feedback',
  request: {
    params: z.object({
      messageId: z.string().min(1),
    }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: feedbackRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Feedback accepted',
      content: {
        'application/json': {
          schema: feedbackResponseSchema,
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

/** 内部運用者が AI ナレッジの鮮度を確認する OpenAPI route 定義。 */
export const internalKnowledgeRoute = createRoute({
  method: 'get',
  path: '/knowledge',
  tags: ['Internal AI'],
  summary: 'Review AI knowledge freshness',
  responses: {
    200: {
      description: 'Knowledge status list',
      content: {
        'application/json': {
          schema: z.object({
            documents: z.array(knowledgeStatusSchema),
          }),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

/** 内部運用者が直近の低評価 feedback 傾向を確認する OpenAPI route 定義。 */
export const internalFeedbackThemesRoute = createRoute({
  method: 'get',
  path: '/feedback-themes',
  tags: ['Internal AI'],
  summary: 'Review AI feedback themes',
  responses: {
    200: {
      description: 'Feedback themes',
      content: {
        'application/json': {
          schema: z.object({
            themes: z.array(feedbackThemeSchema),
          }),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

/** AI チャット request body の型。 */
export type AiChatRequestBody = z.infer<typeof aiChatRequestSchema>;

/** AI チャット response body の型。 */
export type AiChatResponseBody = z.infer<typeof aiChatResponseSchema>;

/** AI feedback route の path params 型。 */
export type AiFeedbackRouteParams = z.infer<typeof feedbackRoute.request.params>;

/** AI feedback request body の型。 */
export type AiFeedbackRequestBody = z.infer<typeof feedbackRequestSchema>;

/** AI feedback response body の型。 */
export type AiFeedbackResponseBody = z.infer<typeof feedbackResponseSchema>;

/** 内部ナレッジ状態 response item の型。 */
export type AiKnowledgeStatusBody = z.infer<typeof knowledgeStatusSchema>;

/** 内部 feedback theme response item の型。 */
export type AiFeedbackThemeBody = z.infer<typeof feedbackThemeSchema>;
