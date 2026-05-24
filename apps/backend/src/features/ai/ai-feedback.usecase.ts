import { jsonResult, type JsonRouteResult } from '../../shared/route-result.js';
import type { AiRouteContext } from './ai-route-context.js';
import type {
  AiFeedbackRequestBody,
  AiFeedbackResponseBody,
  AiFeedbackRouteParams,
} from './ai.schemas.js';

export type SubmitAiMessageFeedbackInput = {
  ctx: AiRouteContext;
  params: AiFeedbackRouteParams;
  body: AiFeedbackRequestBody;
  headers: Headers;
};

/**
 * 呼び出し側の現在スコープ内の assistant message にだけ feedback を upsert する。
 */
export const submitAiMessageFeedback = async ({
  ctx,
  params,
  body,
  headers,
}: SubmitAiMessageFeedbackInput): Promise<JsonRouteResult> => {
  const requestContext = await ctx.resolveRequestContext({
    headers,
  });

  if (!requestContext) {
    return jsonResult({ message: 'Unauthorized.' }, 401);
  }

  const allowed = await ctx.conversationStore.canUserAccessAssistantMessage({
    messageId: params.messageId,
    scope: {
      userId: requestContext.identity.userId,
      organizationId: requestContext.access.organizationId,
      classroomId: requestContext.access.classroomId,
    },
  });
  if (!allowed) {
    return jsonResult({ message: 'Forbidden.' }, 403);
  }

  const feedback = await ctx.conversationStore.submitFeedback({
    messageId: params.messageId,
    userId: requestContext.identity.userId,
    rating: body.rating,
    comment: body.comment,
  });

  return jsonResult(
    {
      feedbackId: feedback.id,
      messageId: feedback.messageId,
      rating: feedback.rating === 'helpful' ? 'helpful' : 'unhelpful',
    } satisfies AiFeedbackResponseBody,
    200,
  );
};
