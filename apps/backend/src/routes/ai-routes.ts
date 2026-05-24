import { OpenAPIHono } from '@hono/zod-openapi';
import type { AuthInstance, AuthRuntimeDatabase } from '../auth-runtime.js';
import { createAiRouteContext, type AiRoutesEnv } from '../features/ai/ai-route-context.js';
import { askAiChat } from '../features/ai/ai-chat.usecase.js';
import { submitAiMessageFeedback } from '../features/ai/ai-feedback.usecase.js';
import {
  listInternalAiFeedbackThemes,
  listInternalAiKnowledge,
} from '../features/ai/ai-internal.usecase.js';
import {
  chatRoute,
  feedbackRoute,
  internalFeedbackThemesRoute,
  internalKnowledgeRoute,
} from '../features/ai/ai.schemas.js';
import { jsonRouteResult } from '../shared/route-result.js';

type CreateAiRoutesOptions = {
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AiRoutesEnv;
};

const jsonAiRouteResult = (...args: Parameters<typeof jsonRouteResult>) =>
  jsonRouteResult(...args) as never;

/**
 * 認証済み AI route と内部 AI inspection route を作成する。
 */
export const createAiRoutes = ({ auth, database, env }: CreateAiRoutesOptions) => {
  const aiRoutes = new OpenAPIHono();
  const internalAiRoutes = new OpenAPIHono();
  const ctx = createAiRouteContext({ auth, database, env });

  aiRoutes.openapi(chatRoute, async (c) =>
    jsonAiRouteResult(
      c,
      await askAiChat({
        ctx,
        body: c.req.valid('json'),
        headers: c.req.raw.headers,
      }),
    ),
  );

  aiRoutes.openapi(feedbackRoute, async (c) =>
    jsonAiRouteResult(
      c,
      await submitAiMessageFeedback({
        ctx,
        params: c.req.valid('param'),
        body: c.req.valid('json'),
        headers: c.req.raw.headers,
      }),
    ),
  );

  internalAiRoutes.openapi(internalKnowledgeRoute, async (c) =>
    jsonAiRouteResult(
      c,
      await listInternalAiKnowledge({
        ctx,
        headers: c.req.raw.headers,
      }),
    ),
  );

  internalAiRoutes.openapi(internalFeedbackThemesRoute, async (c) =>
    jsonAiRouteResult(
      c,
      await listInternalAiFeedbackThemes({
        ctx,
        headers: c.req.raw.headers,
      }),
    ),
  );

  return {
    aiRoutes,
    internalAiRoutes,
  };
};
