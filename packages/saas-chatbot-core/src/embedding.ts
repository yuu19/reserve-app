export type AiEmbeddingResult = {
  vector: number[];
  shape: number[] | null;
  model: string;
};

export type GenerateEmbeddingInput = {
  text: string;
  cache?: boolean;
};

export interface EmbeddingProvider {
  isConfigured: boolean;
  generateEmbedding(input: GenerateEmbeddingInput): Promise<AiEmbeddingResult>;
}

export type AiEmbeddingProvider = EmbeddingProvider;
