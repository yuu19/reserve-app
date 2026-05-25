import { jsonResult, type JsonRouteResult } from '../../shared/route-result.js';
import { summarizeAiError } from './answer-generator.js';
import type { AiRouteContext } from './ai-route-context.js';
import type { AiChatRequestBody, AiChatResponseBody } from './ai.schemas.js';
import { readRetrievedContextSummary } from './conversation-store.js';
import type { RetrievedKnowledgeChunk } from './retriever.js';

export type AskAiChatInput = {
  ctx: AiRouteContext;
  body: AiChatRequestBody;
  headers: Headers;
  startedAt?: number;
};

/**
 * AI チャットの認可、利用回数消費、検索、生成、会話保存を route 非依存で実行する。
 */
export const askAiChat = async ({
  ctx,
  body,
  headers,
  startedAt = Date.now(),
}: AskAiChatInput): Promise<JsonRouteResult> => {
  const requestContext = await ctx.resolveRequestContext({
    headers,
    organizationId: body.organizationId,
    classroomId: body.classroomId,
    currentPage: body.currentPage,
  });

  if (!requestContext) {
    return jsonResult({ message: 'Unauthorized or forbidden.' }, 401);
  }

  const rateLimit = await ctx.checkAndIncrementUsage({
    userId: requestContext.identity.userId,
    organizationId: requestContext.access.organizationId,
  });
  if (!rateLimit.allowed) {
    return jsonResult(
      {
        message: 'AIチャットの利用上限に達しました。時間をおいて再試行してください。',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      429,
    );
  }

  const conversationScope = {
    userId: requestContext.identity.userId,
    organizationId: requestContext.access.organizationId,
    classroomId: requestContext.access.classroomId,
  };
  const conversation = await ctx.conversationStore.ensureConversation({
    conversationId: body.conversationId,
    scope: conversationScope,
    title: body.message,
  });
  if (!conversation) {
    return jsonResult({ message: 'Conversation scope is not permitted.' }, 403);
  }

  await ctx.conversationStore.insertMessage({
    conversationId: conversation.conversationId,
    role: 'user',
    content: body.message,
  });

  let retrieved: RetrievedKnowledgeChunk[] = [];
  let retrievalErrorSummary: string | null = null;
  try {
    retrieved = await ctx.retrieveKnowledge({
      message: body.message,
      context: requestContext.access,
      allowedVisibilities: requestContext.allowedVisibilities,
      internalOperator: requestContext.internalOperator,
    });
  } catch (error) {
    // 検索失敗時も conversation は捨てず、根拠不足として回答と
    // エラー概要を保存し、あとから確認できるようにする。
    console.warn('[ai-chat] retrieval failed', error);
    retrievalErrorSummary = summarizeAiError(error);
  }

  const businessFacts = await ctx.resolveBusinessFacts({
    access: requestContext.access,
  });
  const generated = await ctx.generateAnswer({
    userId: requestContext.identity.userId,
    access: requestContext.access,
    currentPage: requestContext.currentPage,
    message: body.message,
    retrievedContexts: retrieved,
    businessFacts,
    retrievalErrorSummary,
  });
  const safeSources = generated.sources
    .map((source) =>
      ctx.sanitizeSourceReference({
        source,
        access: requestContext.access,
        internalOperator: requestContext.internalOperator,
      }),
    )
    .filter((source): source is NonNullable<typeof source> => Boolean(source));

  const assistantMessage = await ctx.conversationStore.insertMessage({
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
    provider: generated.provider,
    model: generated.model,
    inputTokens: generated.inputTokens,
    outputTokens: generated.outputTokens,
    latencyMs: generated.latencyMs,
    generationStatus: generated.generationStatus,
    errorCode: generated.errorCode,
    errorSummary: generated.errorSummary,
    aiGatewayLogId: generated.aiGatewayLogId,
  });

  await ctx.conversationStore.recordUsageEvent({
    scope: conversationScope,
    conversationId: conversation.conversationId,
    messageId: assistantMessage.id,
    provider: generated.provider,
    model: generated.model,
    inputTokens: generated.inputTokens,
    outputTokens: generated.outputTokens,
    latencyMs: generated.latencyMs,
    generationStatus: generated.generationStatus,
    errorCode: generated.errorCode,
    errorSummary: generated.errorSummary,
    aiGatewayLogId: generated.aiGatewayLogId,
  });

  ctx.recordChatBreadcrumb({
    access: requestContext.access,
    generated,
    retrievalErrorSummary,
    durationMs: Date.now() - startedAt,
  });

  return jsonResult(
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
    } satisfies AiChatResponseBody,
    200,
  );
};
