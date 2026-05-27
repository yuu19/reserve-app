import type { BusinessFactSummary, RetrievedKnowledgeContext } from './knowledge.js';
import type { PromptMessage } from './prompt.js';
import type { AiGeneratedSourceReference } from './source-visibility.js';
import type { AiGenerationStatus } from './types.js';
import type { AiSuggestedAction } from './ui-contract.js';

/** 回答生成モデルへ渡す会話メッセージ。 */
export type AiAnswerModelMessage = PromptMessage;

/** AI プロバイダーに回答生成を依頼するときの入力。 */
export type AiAnswerModelGenerationInput = {
  /** プロバイダーの既定値を上書きする model 名。 */
  model?: string;
  /** system/user/assistant を含む生成用 prompt。 */
  messages: AiAnswerModelMessage[];
  /** プロバイダー側 cache を使わない場合は `true`。 */
  skipCache: boolean;
  /** プロバイダー側 cache を使う場合の TTL 秒数。 */
  cacheTtl?: number;
  /** AI Gateway や可観測性基盤に渡す補足メタデータ。 */
  metadata?: Record<string, unknown>;
};

/** AI プロバイダーから返る低レベルな生成結果と計測値。 */
export type AiAnswerModelGenerationResult = {
  /** プロバイダー SDK が返した生の結果。 */
  result: unknown;
  /** 実際に利用したプロバイダー名。 */
  provider: string;
  /** 実際に利用した model 名。 */
  model: string;
  /** 入力 token 数。プロバイダーから取得できない場合は `null`。 */
  inputTokens: number | null;
  /** 出力 token 数。プロバイダーから取得できない場合は `null`。 */
  outputTokens: number | null;
  /** AI Gateway の log ID。取得できない場合は `null`。 */
  aiGatewayLogId: string | null;
  /** プロバイダー呼び出しにかかった時間。 */
  latencyMs: number;
};

/** Workers AI などの回答生成プロバイダーを抽象化する境界。 */
export interface AnswerGenerationProvider {
  /** プロバイダーが設定済みで呼び出し可能かどうか。 */
  isConfigured: boolean;
  /** プロバイダー名。 */
  provider: string;
  /** 既定 model 名。 */
  model: string;
  /** prompt から回答を生成する。 */
  generate(input: AiAnswerModelGenerationInput): Promise<AiAnswerModelGenerationResult>;
  /** プロバイダー SDK 結果から AI Gateway log ID を抽出する。 */
  readAiGatewayLogId(result?: unknown): string | null;
}

/** 旧呼称との互換を保つ回答生成プロバイダー型。 */
export type AiAnswerModelProvider = AnswerGenerationProvider;

/** UI と conversation 永続化処理に渡す正規化済みの AI 回答。 */
export type GeneratedAiAnswer = {
  /** 利用者へ表示する回答本文。 */
  answer: string;
  /** 回答根拠として表示可能な参照元。 */
  sources: AiGeneratedSourceReference[];
  /** 回答後に UI が提示できる次アクション。 */
  suggestedActions: AiSuggestedAction[];
  /** 根拠との対応と生成品質を 0-1 の範囲で示す信頼度。 */
  confidence: number;
  /** 人によるサポートへ誘導すべき場合は `true`。 */
  needsHumanSupport: boolean;
  /** 実際に利用したプロバイダー名。 */
  provider: string;
  /** 実際に利用した model 名。 */
  model: string;
  /** 入力 token 数。取得できない場合は `null`。 */
  inputTokens: number | null;
  /** 出力 token 数。取得できない場合は `null`。 */
  outputTokens: number | null;
  /** 生成処理全体にかかった時間。 */
  latencyMs: number;
  /** 生成成功または代替応答の分類。 */
  generationStatus: AiGenerationStatus;
  /** 代替応答や失敗時に運用者へ残す短い説明。 */
  errorSummary?: string | null;
  /** 代替応答や失敗時に UI/ログが分岐できる安定コード。 */
  errorCode?: string | null;
  /** AI Gateway の log ID。取得できない場合は `null`。 */
  aiGatewayLogId?: string | null;
};

/** 回答生成ユースケースが prompt、検索結果、業務情報をまとめて受け取る入力。 */
export type AnswerGeneratorInput<TContext = unknown> = {
  /** 回答を要求した user ID。 */
  userId: string;
  /** 参照元の公開範囲や業務情報の解決に使う実行時の文脈。 */
  context: TContext;
  /** 利用者が質問した画面の path。 */
  currentPage?: string | null;
  /** 利用者の質問本文。 */
  message: string;
  /** ナレッジ検索で取得した文脈。 */
  retrievedContexts: RetrievedKnowledgeContext[];
  /** 回答時点で backend が注入する業務情報。 */
  businessFacts: BusinessFactSummary | null;
  /** ナレッジ検索失敗時に代替応答へ渡す要約。 */
  retrievalErrorSummary?: string | null;
  /** 実際の回答生成を担うプロバイダー境界。 */
  answerProvider: AnswerGenerationProvider;
};
