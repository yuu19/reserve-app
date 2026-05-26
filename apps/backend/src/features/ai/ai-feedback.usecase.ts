import { jsonResult, type JsonRouteResult } from '../../shared/route-result.js';
import { getSessionIdentity } from '../../domain/booking/authorization.js';
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
 * 呼び出し側自身の assistant message にだけ feedback を upsert する。
 */
export const submitAiMessageFeedback = async ({
  ctx,
  params,
  body,
  headers,
}: SubmitAiMessageFeedbackInput): Promise<JsonRouteResult> => {
  const identity = await getSessionIdentity(ctx.auth, headers);

  if (!identity) {
    return jsonResult({ message: 'Unauthorized.' }, 401);
  }

  const allowed = await ctx.conversationStore.canUserAccessAssistantMessageByUser({
    messageId: params.messageId,
    userId: identity.userId,
  });
  if (!allowed) {
    return jsonResult({ message: 'Forbidden.' }, 403);
  }

  const feedback = await ctx.conversationStore.submitFeedback({
    messageId: params.messageId,
    userId: identity.userId,
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
