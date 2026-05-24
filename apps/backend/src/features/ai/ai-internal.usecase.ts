import { jsonResult, type JsonRouteResult } from '../../shared/route-result.js';
import type { AiRouteContext } from './ai-route-context.js';

type InternalAiUsecaseInput = {
  ctx: AiRouteContext;
  headers: Headers;
};

const internalOperatorDeniedResult = (status: 401 | 403): JsonRouteResult => {
  if (status === 401) {
    return jsonResult({ message: 'Unauthorized.' }, 401);
  }
  return jsonResult({ message: 'Forbidden.' }, 403);
};

export const listInternalAiKnowledge = async ({
  ctx,
  headers,
}: InternalAiUsecaseInput): Promise<JsonRouteResult> => {
  const operator = await ctx.ensureInternalOperator({ headers });
  if (operator.status !== 200) {
    return internalOperatorDeniedResult(operator.status);
  }

  return jsonResult({ documents: await ctx.observabilityStore.listKnowledgeStatuses() }, 200);
};

export const listInternalAiFeedbackThemes = async ({
  ctx,
  headers,
}: InternalAiUsecaseInput): Promise<JsonRouteResult> => {
  const operator = await ctx.ensureInternalOperator({ headers });
  if (operator.status !== 200) {
    return internalOperatorDeniedResult(operator.status);
  }

  return jsonResult({ themes: await ctx.observabilityStore.listFeedbackThemes() }, 200);
};
