import type { BusinessFactSummary, RetrievedKnowledgeContext } from './knowledge.js';
import type { PromptMessage } from './prompt.js';
import type { AiGeneratedSourceReference } from './source-visibility.js';
import type { AiGenerationStatus } from './types.js';
import type { AiSuggestedAction } from './ui-contract.js';

export type AiAnswerModelMessage = PromptMessage;

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

export interface AnswerGenerationProvider {
  isConfigured: boolean;
  provider: string;
  model: string;
  generate(input: AiAnswerModelGenerationInput): Promise<AiAnswerModelGenerationResult>;
  readAiGatewayLogId(result?: unknown): string | null;
}

export type AiAnswerModelProvider = AnswerGenerationProvider;

export type GeneratedAiAnswer = {
  answer: string;
  sources: AiGeneratedSourceReference[];
  suggestedActions: AiSuggestedAction[];
  confidence: number;
  needsHumanSupport: boolean;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  generationStatus: AiGenerationStatus;
  errorSummary?: string | null;
  errorCode?: string | null;
  aiGatewayLogId?: string | null;
};

export type AnswerGeneratorInput<TContext = unknown> = {
  userId: string;
  context: TContext;
  currentPage?: string | null;
  message: string;
  retrievedContexts: RetrievedKnowledgeContext[];
  businessFacts: BusinessFactSummary | null;
  retrievalErrorSummary?: string | null;
  answerProvider: AnswerGenerationProvider;
};
