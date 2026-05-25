import type { BusinessFactSummary, RetrievedKnowledgeContext } from './knowledge.js';

export type PromptMessageRole = 'system' | 'user' | 'assistant';

export type PromptMessage = {
  role: PromptMessageRole;
  content: string;
};

export type BuildPromptInput<TContext = unknown> = {
  userId: string;
  context: TContext;
  currentPage?: string | null;
  retrievedContexts: RetrievedKnowledgeContext[];
  businessFacts: BusinessFactSummary | null;
  message: string;
};

export type BuildPromptResult = {
  systemPrompt: string;
  userPrompt: string;
  skipCache: boolean;
  cacheTtl?: number;
  metadata?: Record<string, unknown>;
};

export interface PromptBuilder<TContext = unknown> {
  build(input: BuildPromptInput<TContext>): BuildPromptResult | Promise<BuildPromptResult>;
}
