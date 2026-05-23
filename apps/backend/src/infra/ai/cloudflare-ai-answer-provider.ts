export type AiAnswerEnv = {
  AI?: {
    run: (
      model: string,
      inputs: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
    aiGatewayLogId?: string | null;
  };
  AI_ANSWER_MODEL?: string;
  AI_GATEWAY_ID?: string;
};

export type AiAnswerModelMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AiAnswerModelGenerationInput = {
  model?: string;
  messages: AiAnswerModelMessage[];
  skipCache: boolean;
  cacheTtl?: number;
  metadata?: Record<string, unknown>;
};

export type AiAnswerModelGenerationResult = {
  result: unknown;
  aiGatewayLogId: string | null;
  latencyMs: number;
};

export type AiAnswerModelProvider = {
  isConfigured: boolean;
  model: string;
  generate(input: AiAnswerModelGenerationInput): Promise<AiAnswerModelGenerationResult>;
  readAiGatewayLogId(result?: unknown): string | null;
};

const DEFAULT_ANSWER_MODEL = '@cf/meta/llama-3.1-8b-instruct';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readHeaderValue = (headers: unknown, name: string): string | null => {
  if (!headers) {
    return null;
  }

  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get: (key: string) => string | null }).get(name);
    return value && value.trim().length > 0 ? value.trim() : null;
  }

  if (isRecord(headers)) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  return null;
};

export const readAiGatewayLogId = ({
  env,
  result,
}: {
  env: AiAnswerEnv;
  result?: unknown;
}): string | null => {
  // Workers AI は最新の AI Gateway ログ ID を binding に出す一方、レスポンスヘッダーに
  // 出る形もあり得るため、デプロイ差分に備えて両方を読む。
  const bindingLogId = env.AI?.aiGatewayLogId;
  if (typeof bindingLogId === 'string' && bindingLogId.trim().length > 0) {
    return bindingLogId.trim();
  }

  if (isRecord(result)) {
    return readHeaderValue(result.headers, 'cf-aig-log-id');
  }

  return null;
};

export const createWorkersAiAnswerModelProvider = ({
  env,
}: {
  env: AiAnswerEnv;
}): AiAnswerModelProvider => {
  const defaultModel = env.AI_ANSWER_MODEL?.trim() || DEFAULT_ANSWER_MODEL;

  return {
    isConfigured: Boolean(env.AI),
    model: defaultModel,

    async generate({ model, messages, skipCache, cacheTtl, metadata }) {
      if (!env.AI) {
        throw new Error('Workers AI binding is not configured.');
      }

      const generationStartedAt = Date.now();
      const result = await env.AI.run(
        model ?? defaultModel,
        {
          messages,
        },
        env.AI_GATEWAY_ID
          ? {
              gateway: {
                id: env.AI_GATEWAY_ID,
                skipCache,
                cacheTtl,
                metadata: {
                  purpose: 'ai-chat-answer',
                  ...metadata,
                },
              },
            }
          : undefined,
      );

      return {
        result,
        aiGatewayLogId: readAiGatewayLogId({ env, result }),
        latencyMs: Date.now() - generationStartedAt,
      };
    },

    readAiGatewayLogId: (result) => readAiGatewayLogId({ env, result }),
  };
};
