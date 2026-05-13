export type AiEmbeddingEnv = {
  AI?: {
    run: (
      model: string,
      inputs: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
  AI_GATEWAY_ID?: string;
  AI_EMBEDDING_MODEL?: string;
};

const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3';

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const readEmbeddingVector = (result: unknown): number[] => {
  if (isRecord(result)) {
    const data = result.data;
    if (Array.isArray(data) && isNumberArray(data[0])) {
      return data[0];
    }

    const response = result.response;
    if (Array.isArray(response) && isNumberArray(response[0])) {
      return response[0];
    }

    if (isNumberArray(result.embedding)) {
      return result.embedding;
    }

    if (isNumberArray(result.vector)) {
      return result.vector;
    }
  }

  throw new Error('Workers AI embedding response did not include a vector.');
};

export const readEmbeddingShape = (result: unknown): number[] | null => {
  if (!isRecord(result)) {
    return null;
  }

  const shape = result.shape;
  if (Array.isArray(shape) && shape.every((entry) => typeof entry === 'number')) {
    return shape;
  }

  try {
    return [1, readEmbeddingVector(result).length];
  } catch {
    return null;
  }
};

export const generateEmbedding = async ({
  env,
  text,
  cache = true,
}: {
  env: AiEmbeddingEnv;
  text: string;
  cache?: boolean;
}): Promise<{ vector: number[]; shape: number[] | null; model: string }> => {
  if (!env.AI) {
    throw new Error('Workers AI binding is not configured.');
  }

  const model = env.AI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  const result = await env.AI.run(
    model,
    {
      text,
    },
    env.AI_GATEWAY_ID
      ? {
          gateway: {
            id: env.AI_GATEWAY_ID,
            skipCache: !cache,
            cacheTtl: cache ? 300 : undefined,
            metadata: {
              purpose: 'ai-chat-embedding',
            },
          },
        }
      : undefined,
  );

  return {
    vector: readEmbeddingVector(result),
    shape: readEmbeddingShape(result),
    model,
  };
};
