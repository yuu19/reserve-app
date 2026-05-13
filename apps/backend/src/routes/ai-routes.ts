import * as Sentry from '@sentry/cloudflare';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import { generateAnswer, summarizeAiError, type AiAnswerEnv } from '../ai/answer-generator.js';
import { resolveBusinessFacts } from '../ai/business-facts.js';
import { resolveAiRequestContext } from '../ai/context-resolver.js';
import {
  canUserAccessAssistantMessage,
  ensureAiConversation,
  insertAiMessage,
  listAiFeedbackThemes,
  listAiKnowledgeStatuses,
  readRetrievedContextSummary,
  submitAiFeedback,
} from '../ai/conversation-store.js';
import { checkAndIncrementAiUsage } from '../ai/rate-limit.js';
import {
  retrieveKnowledge,
  type AiRetrieverEnv,
  type RetrievedKnowledgeChunk,
} from '../ai/retriever.js';
import { sanitizeSourceReference } from '../ai/source-visibility.js';
import { getSessionIdentity } from '../booking/authorization.js';
import { canAccessInternalBillingInspection } from '../billing/internal-operator-access.js';

type AiRoutesEnv = AuthRuntimeEnv & AiAnswerEnv & AiRetrieverEnv;

type CreateAiRoutesOptions = {
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AiRoutesEnv;
};

const aiSourceKindSchema = z.enum(['docs', 'specs', 'faq', 'db_summary']);
const aiSourceVisibilitySchema = z.enum([
  'public',
  'authenticated',
  'participant',
  'staff',
  'manager',
  'admin',
  'owner',
]);
const aiSuggestedActionSchema = z.object({
  label: z.string(),
  href: z.string().nullable().optional(),
  actionKind: z.enum(['open_page', 'contact_owner', 'contact_support']),
});

const aiChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().optional(),
  organizationId: z.string().optional(),
  classroomId: z.string().optional(),
  currentPage: z.string().max(2048).optional(),
});

const aiSourceReferenceSchema = z.object({
  sourceKind: aiSourceKindSchema,
  title: z.string(),
  sourcePath: z.string().nullable().optional(),
  chunkId: z.string().nullable().optional(),
  visibility: aiSourceVisibilitySchema.optional(),
});

const aiChatResponseSchema = z.object({
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

const feedbackRequestSchema = z.object({
  rating: z.enum(['helpful', 'unhelpful']),
  comment: z.string().max(1000).optional(),
});

const feedbackResponseSchema = z.object({
  feedbackId: z.string(),
  messageId: z.string(),
  rating: z.enum(['helpful', 'unhelpful']),
});

const knowledgeStatusSchema = z.object({
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

const feedbackThemeSchema = z.object({
  theme: z.string(),
  count: z.number().int().min(0),
  latestAt: z.string().nullable(),
});

const chatRoute = createRoute({
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

const feedbackRoute = createRoute({
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

const internalKnowledgeRoute = createRoute({
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

const internalFeedbackThemesRoute = createRoute({
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

const getEmailVerified = (session: unknown): boolean => {
  if (typeof session !== 'object' || session === null) {
    return false;
  }
  const user = (session as Record<string, unknown>).user;
  if (typeof user !== 'object' || user === null) {
    return false;
  }
  return (user as Record<string, unknown>).emailVerified === true;
};

const ensureInternalOperator = async ({
  auth,
  env,
  headers,
}: {
  auth: AuthInstance;
  env: AuthRuntimeEnv;
  headers: Headers;
}) => {
  const [identity, session] = await Promise.all([
    getSessionIdentity(auth, headers),
    auth.api.getSession({ headers }),
  ]);
  if (!identity) {
    return { status: 401 as const };
  }
  if (
    !canAccessInternalBillingInspection({
      env,
      email: identity.email,
      emailVerified: getEmailVerified(session),
    })
  ) {
    return { status: 403 as const };
  }
  return { status: 200 as const };
};

export const createAiRoutes = ({ auth, database, env }: CreateAiRoutesOptions) => {
  const aiRoutes = new OpenAPIHono();
  const internalAiRoutes = new OpenAPIHono();

  aiRoutes.openapi(chatRoute, async (c) => {
    const body = c.req.valid('json');
    const startedAt = Date.now();
    const context = await resolveAiRequestContext({
      auth,
      database,
      env,
      headers: c.req.raw.headers,
      organizationId: body.organizationId,
      classroomId: body.classroomId,
      currentPage: body.currentPage,
    });

    if (!context) {
      return c.json({ message: 'Unauthorized or forbidden.' }, 401);
    }

    const rateLimit = await checkAndIncrementAiUsage({
      database,
      userId: context.identity.userId,
      organizationId: context.access.organizationId,
    });
    if (!rateLimit.allowed) {
      return c.json(
        {
          message: 'AIチャットの利用上限に達しました。時間をおいて再試行してください。',
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        429,
      );
    }

    const conversation = await ensureAiConversation({
      database,
      conversationId: body.conversationId,
      scope: {
        userId: context.identity.userId,
        organizationId: context.access.organizationId,
        classroomId: context.access.classroomId,
      },
      title: body.message,
    });
    if (!conversation) {
      return c.json({ message: 'Conversation scope is not permitted.' }, 403);
    }

    await insertAiMessage({
      database,
      conversationId: conversation.conversationId,
      role: 'user',
      content: body.message,
    });

    let retrieved: RetrievedKnowledgeChunk[] = [];
    let retrievalErrorSummary: string | null = null;
    try {
      retrieved = await retrieveKnowledge({
        env,
        database,
        message: body.message,
        access: context.access,
        allowedVisibilities: context.allowedVisibilities,
        internalOperator: context.internalOperator,
      });
    } catch (error) {
      console.warn('[ai-chat] retrieval failed', error);
      retrievalErrorSummary = summarizeAiError(error);
    }

    const businessFacts = await resolveBusinessFacts({
      database,
      access: context.access,
    });
    const generated = await generateAnswer({
      env,
      userId: context.identity.userId,
      access: context.access,
      currentPage: context.currentPage,
      message: body.message,
      retrievedContexts: retrieved,
      businessFacts,
      retrievalErrorSummary,
    });
    const safeSources = generated.sources
      .map((source) =>
        sanitizeSourceReference({
          source,
          access: context.access,
          internalOperator: context.internalOperator,
        }),
      )
      .filter((source): source is NonNullable<typeof source> => Boolean(source));

    const assistantMessage = await insertAiMessage({
      database,
      conversationId: conversation.conversationId,
      role: 'assistant',
      content: generated.answer,
      sources: safeSources,
      retrievedContext: readRetrievedContextSummary({
        chunks: retrieved,
        businessFactKeys: businessFacts.factKeys,
        retrievalErrorSummary,
      }),
      confidence: generated.confidence,
      needsHumanSupport: generated.needsHumanSupport,
      aiGatewayLogId: generated.aiGatewayLogId,
      aiModel: generated.model,
      aiLatencyMs: generated.latencyMs,
      aiGenerationStatus: generated.generationStatus,
      aiErrorSummary: generated.errorSummary,
    });

    Sentry.addBreadcrumb({
      category: 'ai.chat',
      level: 'info',
      data: {
        organizationId: context.access.organizationId,
        classroomId: context.access.classroomId,
        confidence: generated.confidence,
        needsHumanSupport: generated.needsHumanSupport,
        model: generated.model,
        aiGatewayLogId: generated.aiGatewayLogId,
        generationStatus: generated.generationStatus,
        aiLatencyMs: generated.latencyMs,
        hasAiError: Boolean(generated.errorSummary),
        retrievalFailed: Boolean(retrievalErrorSummary),
        durationMs: Date.now() - startedAt,
      },
    });

    return c.json(
      {
        conversationId: conversation.conversationId,
        messageId: assistantMessage.id,
        answer: generated.answer,
        sources: safeSources,
        suggestedActions: generated.suggestedActions,
        confidence: generated.confidence,
        needsHumanSupport: generated.needsHumanSupport,
        rateLimit: {
          userRemainingThisHour: rateLimit.userRemainingThisHour,
          organizationRemainingToday: rateLimit.organizationRemainingToday,
        },
      },
      200,
    );
  });

  aiRoutes.openapi(feedbackRoute, async (c) => {
    const { messageId } = c.req.valid('param');
    const body = c.req.valid('json');
    const context = await resolveAiRequestContext({
      auth,
      database,
      env,
      headers: c.req.raw.headers,
    });

    if (!context) {
      return c.json({ message: 'Unauthorized.' }, 401);
    }

    const allowed = await canUserAccessAssistantMessage({
      database,
      messageId,
      scope: {
        userId: context.identity.userId,
        organizationId: context.access.organizationId,
        classroomId: context.access.classroomId,
      },
    });
    if (!allowed) {
      return c.json({ message: 'Forbidden.' }, 403);
    }

    const feedback = await submitAiFeedback({
      database,
      messageId,
      userId: context.identity.userId,
      rating: body.rating,
      comment: body.comment,
    });

    return c.json(
      {
        feedbackId: feedback.id,
        messageId: feedback.messageId,
        rating: feedback.rating === 'helpful' ? 'helpful' : 'unhelpful',
      },
      200,
    );
  });

  internalAiRoutes.openapi(internalKnowledgeRoute, async (c) => {
    const operator = await ensureInternalOperator({
      auth,
      env,
      headers: c.req.raw.headers,
    });
    if (operator.status === 401) {
      return c.json({ message: 'Unauthorized.' }, 401);
    }
    if (operator.status === 403) {
      return c.json({ message: 'Forbidden.' }, 403);
    }
    return c.json({ documents: await listAiKnowledgeStatuses({ database }) }, 200);
  });

  internalAiRoutes.openapi(internalFeedbackThemesRoute, async (c) => {
    const operator = await ensureInternalOperator({
      auth,
      env,
      headers: c.req.raw.headers,
    });
    if (operator.status === 401) {
      return c.json({ message: 'Unauthorized.' }, 401);
    }
    if (operator.status === 403) {
      return c.json({ message: 'Forbidden.' }, 403);
    }
    return c.json({ themes: await listAiFeedbackThemes({ database }) }, 200);
  });

  return {
    aiRoutes,
    internalAiRoutes,
  };
};
