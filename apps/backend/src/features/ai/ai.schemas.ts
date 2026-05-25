import { createRoute, z } from '@hono/zod-openapi';
import {
  AI_FEEDBACK_RATINGS,
  AI_SOURCE_KINDS,
  AI_SOURCE_VISIBILITIES,
  AI_SUGGESTED_ACTION_KINDS,
} from '@repo/saas-chatbot-core';

export const aiSourceKindSchema = z.enum(AI_SOURCE_KINDS);
export const aiSourceVisibilitySchema = z.enum(AI_SOURCE_VISIBILITIES);
export const aiSuggestedActionSchema = z.object({
  label: z.string(),
  href: z.string().nullable().optional(),
  actionKind: z.enum(AI_SUGGESTED_ACTION_KINDS),
});

export const aiChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().optional(),
  organizationId: z.string().optional(),
  classroomId: z.string().optional(),
  currentPage: z.string().max(2048).optional(),
});

export const aiSourceReferenceSchema = z.object({
  sourceKind: aiSourceKindSchema,
  title: z.string(),
  sourcePath: z.string().nullable().optional(),
  chunkId: z.string().nullable().optional(),
  visibility: aiSourceVisibilitySchema.optional(),
});

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

export const feedbackRequestSchema = z.object({
  rating: z.enum(AI_FEEDBACK_RATINGS),
  comment: z.string().max(1000).optional(),
});

export const feedbackResponseSchema = z.object({
  feedbackId: z.string(),
  messageId: z.string(),
  rating: z.enum(AI_FEEDBACK_RATINGS),
});

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

export const feedbackThemeSchema = z.object({
  theme: z.string(),
  count: z.number().int().min(0),
  latestAt: z.string().nullable(),
});

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

export type AiChatRequestBody = z.infer<typeof aiChatRequestSchema>;
export type AiChatResponseBody = z.infer<typeof aiChatResponseSchema>;
export type AiFeedbackRouteParams = z.infer<typeof feedbackRoute.request.params>;
export type AiFeedbackRequestBody = z.infer<typeof feedbackRequestSchema>;
export type AiFeedbackResponseBody = z.infer<typeof feedbackResponseSchema>;
export type AiKnowledgeStatusBody = z.infer<typeof knowledgeStatusSchema>;
export type AiFeedbackThemeBody = z.infer<typeof feedbackThemeSchema>;
