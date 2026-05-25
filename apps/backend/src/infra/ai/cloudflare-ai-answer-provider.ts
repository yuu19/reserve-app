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
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  aiGatewayLogId: string | null;
  latencyMs: number;
};

export type AiAnswerModelProvider = {
  isConfigured: boolean;
  provider: string;
  model: string;
  generate(input: AiAnswerModelGenerationInput): Promise<AiAnswerModelGenerationResult>;
  readAiGatewayLogId(result?: unknown): string | null;
};

const DEFAULT_ANSWER_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const WORKERS_AI_PROVIDER = 'cloudflare-workers-ai';

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

const readTokenNumber = (value: unknown): number | null => {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
};

const findUsageRecord = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) {
    return null;
  }

  const usage = value.usage ?? value.token_usage ?? value.tokenUsage;
  if (isRecord(usage)) {
    return usage;
  }

  const nestedResult = value.result ?? value.response;
  if (isRecord(nestedResult)) {
    return findUsageRecord(nestedResult);
  }

  return null;
};

export const readAiTokenUsage = (
  result: unknown,
): { inputTokens: number | null; outputTokens: number | null } => {
  const usage = findUsageRecord(result);
  if (!usage) {
    return { inputTokens: null, outputTokens: null };
  }

  return {
    inputTokens: readTokenNumber(
      usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.promptTokens,
    ),
    outputTokens: readTokenNumber(
      usage.output_tokens ??
        usage.completion_tokens ??
        usage.outputTokens ??
        usage.completionTokens,
    ),
  };
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
    provider: WORKERS_AI_PROVIDER,
    model: defaultModel,

    async generate({ model, messages, skipCache, cacheTtl, metadata }) {
      if (!env.AI) {
        throw new Error('Workers AI binding is not configured.');
      }

      const generationStartedAt = Date.now();
      const resolvedModel = model ?? defaultModel;
      const result = await env.AI.run(
        resolvedModel,
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
      const tokenUsage = readAiTokenUsage(result);

      return {
        result,
        provider: WORKERS_AI_PROVIDER,
        model: resolvedModel,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        aiGatewayLogId: readAiGatewayLogId({ env, result }),
        latencyMs: Date.now() - generationStartedAt,
      };
    },

    readAiGatewayLogId: (result) => readAiGatewayLogId({ env, result }),
  };
};
