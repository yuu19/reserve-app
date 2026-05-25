import type { AiAnswerModelProvider, AiEmbeddingProvider } from '@repo/saas-chatbot-core';

export const createFakeAiAnswerModelProvider = ({
  result = {
    response: JSON.stringify({
      answer: 'fake answer',
      confidence: 80,
      needsHumanSupport: false,
      suggestedActions: [],
    }),
  },
  aiGatewayLogId = null,
  latencyMs = 0,
  isConfigured = true,
  provider = 'fake-ai',
  model = 'fake-answer-model',
  inputTokens = null,
  outputTokens = null,
}: {
  result?: unknown;
  aiGatewayLogId?: string | null;
  latencyMs?: number;
  isConfigured?: boolean;
  provider?: string;
  model?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
} = {}): AiAnswerModelProvider => ({
  isConfigured,
  provider,
  model,
  generate: async () => ({
    result,
    provider,
    model,
    inputTokens,
    outputTokens,
    aiGatewayLogId,
    latencyMs,
  }),
  readAiGatewayLogId: () => aiGatewayLogId,
});

export const createFakeAiEmbeddingProvider = ({
  vector = [0.1, 0.2, 0.3],
  shape,
  model = 'fake-embedding-model',
  isConfigured = true,
}: {
  vector?: number[];
  shape?: number[] | null;
  model?: string;
  isConfigured?: boolean;
} = {}): AiEmbeddingProvider => ({
  isConfigured,
  generateEmbedding: async () => ({
    vector: [...vector],
    shape: shape ?? [1, vector.length],
    model,
  }),
});
