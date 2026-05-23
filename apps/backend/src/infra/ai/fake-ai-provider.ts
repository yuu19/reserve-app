import type { AiAnswerModelProvider } from './cloudflare-ai-answer-provider.js';
import type { AiEmbeddingProvider } from './cloudflare-ai-embedding-provider.js';

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
  model = 'fake-answer-model',
}: {
  result?: unknown;
  aiGatewayLogId?: string | null;
  latencyMs?: number;
  isConfigured?: boolean;
  model?: string;
} = {}): AiAnswerModelProvider => ({
  isConfigured,
  model,
  generate: async () => ({
    result,
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
