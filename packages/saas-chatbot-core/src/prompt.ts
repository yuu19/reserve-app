import type { BusinessFactSummary, RetrievedKnowledgeContext } from './knowledge.js';

/** provider に渡す prompt message の role。 */
export type PromptMessageRole = 'system' | 'user' | 'assistant';

/** AI provider へ渡す単一 prompt message。 */
export type PromptMessage = {
  /** message の role。 */
  role: PromptMessageRole;
  /** provider に渡す message 本文。 */
  content: string;
};

/** prompt builder が回答生成に必要な context を受け取る入力。 */
export type BuildPromptInput<TContext = unknown> = {
  /** 質問した user ID。 */
  userId: string;
  /** visibility や業務 facts の前提となる runtime context。 */
  context: TContext;
  /** 質問時の画面 path。 */
  currentPage?: string | null;
  /** retrieval で取得した knowledge context。 */
  retrievedContexts: RetrievedKnowledgeContext[];
  /** 回答時点の業務 facts。 */
  businessFacts: BusinessFactSummary | null;
  /** 利用者の質問本文。 */
  message: string;
};

/** prompt builder が返す provider 用 prompt と cache 指示。 */
export type BuildPromptResult = {
  /** system role に渡す prompt。 */
  systemPrompt: string;
  /** user role に渡す prompt。 */
  userPrompt: string;
  /** provider cache を使わない場合は `true`。 */
  skipCache: boolean;
  /** provider cache を使う場合の TTL 秒数。 */
  cacheTtl?: number;
  /** AI Gateway や observability に渡す metadata。 */
  metadata?: Record<string, unknown>;
};

/** RAG context と business facts から provider 用 prompt を構築する port。 */
export interface PromptBuilder<TContext = unknown> {
  /** provider に渡す prompt と cache 方針を返す。 */
  build(input: BuildPromptInput<TContext>): BuildPromptResult | Promise<BuildPromptResult>;
}
