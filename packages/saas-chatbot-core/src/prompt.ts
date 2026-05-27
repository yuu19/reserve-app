import type { BusinessFactSummary, RetrievedKnowledgeContext } from './knowledge.js';

/** プロバイダーに渡す prompt message の role。 */
export type PromptMessageRole = 'system' | 'user' | 'assistant';

/** AI プロバイダーへ渡す単一 prompt message。 */
export type PromptMessage = {
  /** message の role。 */
  role: PromptMessageRole;
  /** プロバイダーに渡す message 本文。 */
  content: string;
};

/** prompt builder が回答生成に必要な文脈を受け取る入力。 */
export type BuildPromptInput<TContext = unknown> = {
  /** 質問した user ID。 */
  userId: string;
  /** 公開範囲や業務情報の前提となる実行時の文脈。 */
  context: TContext;
  /** 質問時の画面 path。 */
  currentPage?: string | null;
  /** ナレッジ検索で取得した文脈。 */
  retrievedContexts: RetrievedKnowledgeContext[];
  /** 回答時点の業務情報。 */
  businessFacts: BusinessFactSummary | null;
  /** 利用者の質問本文。 */
  message: string;
};

/** prompt builder が返すプロバイダー用 prompt と cache 指示。 */
export type BuildPromptResult = {
  /** system role に渡す prompt。 */
  systemPrompt: string;
  /** user role に渡す prompt。 */
  userPrompt: string;
  /** プロバイダー側 cache を使わない場合は `true`。 */
  skipCache: boolean;
  /** プロバイダー側 cache を使う場合の TTL 秒数。 */
  cacheTtl?: number;
  /** AI Gateway や可観測性基盤に渡すメタデータ。 */
  metadata?: Record<string, unknown>;
};

/** RAG の文脈と業務情報からプロバイダー用 prompt を構築する境界。 */
export interface PromptBuilder<TContext = unknown> {
  /** プロバイダーに渡す prompt と cache 方針を返す。 */
  build(input: BuildPromptInput<TContext>): BuildPromptResult | Promise<BuildPromptResult>;
}
