import type { BusinessFactSummary, RetrievedKnowledgeContext } from './knowledge.js';
import type { PromptMessage } from './prompt.js';
import type { AiGeneratedSourceReference } from './source-visibility.js';
import type { AiGenerationStatus } from './types.js';
import type { AiSuggestedAction } from './ui-contract.js';

/** answer model provider へ渡す会話メッセージ。 */
export type AiAnswerModelMessage = PromptMessage;

/** AI provider に回答生成を依頼するときの入力。 */
export type AiAnswerModelGenerationInput = {
  /** provider の既定値を上書きする model 名。 */
  model?: string;
  /** system/user/assistant を含む生成用 prompt。 */
  messages: AiAnswerModelMessage[];
  /** provider cache を使わない場合は `true`。 */
  skipCache: boolean;
  /** provider cache を使う場合の TTL 秒数。 */
  cacheTtl?: number;
  /** AI Gateway や observability に渡す補足 metadata。 */
  metadata?: Record<string, unknown>;
};

/** AI provider から返る低レベルな生成結果と計測値。 */
export type AiAnswerModelGenerationResult = {
  /** provider SDK が返した生の結果。 */
  result: unknown;
  /** 実際に利用した provider 名。 */
  provider: string;
  /** 実際に利用した model 名。 */
  model: string;
  /** 入力 token 数。provider から取得できない場合は `null`。 */
  inputTokens: number | null;
  /** 出力 token 数。provider から取得できない場合は `null`。 */
  outputTokens: number | null;
  /** AI Gateway の log ID。取得できない場合は `null`。 */
  aiGatewayLogId: string | null;
  /** provider 呼び出しにかかった時間。 */
  latencyMs: number;
};

/** Workers AI などの回答生成 provider を抽象化する port。 */
export interface AnswerGenerationProvider {
  /** provider が設定済みで呼び出し可能かどうか。 */
  isConfigured: boolean;
  /** provider 名。 */
  provider: string;
  /** 既定 model 名。 */
  model: string;
  /** prompt から回答を生成する。 */
  generate(input: AiAnswerModelGenerationInput): Promise<AiAnswerModelGenerationResult>;
  /** provider SDK 結果から AI Gateway log ID を抽出する。 */
  readAiGatewayLogId(result?: unknown): string | null;
}

/** 旧呼称との互換を保つ answer model provider 型。 */
export type AiAnswerModelProvider = AnswerGenerationProvider;

/** UI と conversation store に渡す正規化済みの AI 回答。 */
export type GeneratedAiAnswer = {
  /** 利用者へ表示する回答本文。 */
  answer: string;
  /** 回答根拠として表示可能な source。 */
  sources: AiGeneratedSourceReference[];
  /** 回答後に UI が提示できる次アクション。 */
  suggestedActions: AiSuggestedAction[];
  /** grounding と生成品質を 0-1 の範囲で示す信頼度。 */
  confidence: number;
  /** 人によるサポートへ誘導すべき場合は `true`。 */
  needsHumanSupport: boolean;
  /** 実際に利用した provider 名。 */
  provider: string;
  /** 実際に利用した model 名。 */
  model: string;
  /** 入力 token 数。取得できない場合は `null`。 */
  inputTokens: number | null;
  /** 出力 token 数。取得できない場合は `null`。 */
  outputTokens: number | null;
  /** 生成処理全体の latency。 */
  latencyMs: number;
  /** 生成成功または fallback の分類。 */
  generationStatus: AiGenerationStatus;
  /** fallback や失敗時に運用者へ残す短い説明。 */
  errorSummary?: string | null;
  /** fallback や失敗時に UI/ログが分岐できる安定コード。 */
  errorCode?: string | null;
  /** AI Gateway の log ID。取得できない場合は `null`。 */
  aiGatewayLogId?: string | null;
};

/** 回答生成 usecase が prompt、検索結果、業務 facts をまとめて受け取る入力。 */
export type AnswerGeneratorInput<TContext = unknown> = {
  /** 回答を要求した user ID。 */
  userId: string;
  /** source visibility や business facts 解決に使う runtime context。 */
  context: TContext;
  /** 利用者が質問した画面の path。 */
  currentPage?: string | null;
  /** 利用者の質問本文。 */
  message: string;
  /** retrieval で取得した knowledge context。 */
  retrievedContexts: RetrievedKnowledgeContext[];
  /** 回答時点で backend が注入する業務 facts。 */
  businessFacts: BusinessFactSummary | null;
  /** retrieval 失敗時に fallback 回答へ渡す要約。 */
  retrievalErrorSummary?: string | null;
  /** 実際の回答生成を担う provider port。 */
  answerProvider: AnswerGenerationProvider;
};
