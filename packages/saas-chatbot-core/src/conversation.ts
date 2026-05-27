import type { AiFeedbackRating, AiGenerationStatus, AiMessageRole } from './types.js';
import type { AiSourceReference } from './ui-contract.js';

/** conversation の認可境界を表す scope。 */
export type ConversationScope = {
  /** conversation を開始した user ID。 */
  userId: string;
  /** conversation が紐づく organization ID。 */
  organizationId: string;
  /** classroom 文脈がある場合の classroom ID。 */
  classroomId: string | null;
};

/** assistant message を保存した直後に後続処理へ返す最小情報。 */
export type StoredAssistantMessage = {
  /** 保存した assistant message ID。 */
  id: string;
  /** message が属する conversation ID。 */
  conversationId: string;
};

/** conversation を作成または既存確認する入力。 */
export type EnsureConversationInput = {
  /** クライアントが継続したい conversation ID。新規開始時は省略可能。 */
  conversationId?: string | null;
  /** conversation の認可境界。 */
  scope: ConversationScope;
  /** 初回質問などから付ける conversation title。 */
  title?: string | null;
  /** 保存時刻。未指定時は store 実装の現在時刻を使う。 */
  now?: Date;
};

/** user/assistant message を conversation に保存する入力。 */
export type InsertMessageInput = {
  /** 保存先 conversation ID。 */
  conversationId: string;
  /** message の送信者 role。 */
  role: AiMessageRole;
  /** 保存する message 本文。 */
  content: string;
  /** assistant 回答の表示可能な source。 */
  sources?: AiSourceReference[] | null;
  /** retrieval 結果の監査用 payload。 */
  retrievedContext?: unknown;
  /** assistant 回答の信頼度。 */
  confidence?: number | null;
  /** 人によるサポートへ誘導すべきかどうか。 */
  needsHumanSupport?: boolean;
  /** AI Gateway log ID。 */
  aiGatewayLogId?: string | null;
  /** 利用した provider 名。 */
  provider?: string | null;
  /** 利用した model 名。 */
  model?: string | null;
  /** 入力 token 数。 */
  inputTokens?: number | null;
  /** 出力 token 数。 */
  outputTokens?: number | null;
  /** 生成 latency。 */
  latencyMs?: number | null;
  /** 生成成功または fallback の分類。 */
  generationStatus?: AiGenerationStatus | string | null;
  /** 失敗や fallback の安定コード。 */
  errorCode?: string | null;
  /** 失敗や fallback の短い説明。 */
  errorSummary?: string | null;
  /** 保存時刻。未指定時は store 実装の現在時刻を使う。 */
  now?: Date;
};

/** AI usage counter と observability に記録する生成イベント。 */
export type AiUsageEventInput = {
  /** usage を加算する認可境界。 */
  scope: ConversationScope;
  /** 対象 conversation ID。 */
  conversationId: string;
  /** 対象 message ID。 */
  messageId: string;
  /** 利用した provider 名。 */
  provider?: string | null;
  /** 利用した model 名。 */
  model?: string | null;
  /** 入力 token 数。 */
  inputTokens?: number | null;
  /** 出力 token 数。 */
  outputTokens?: number | null;
  /** 生成 latency。 */
  latencyMs?: number | null;
  /** 生成成功または fallback の分類。 */
  generationStatus: AiGenerationStatus | string;
  /** 失敗や fallback の安定コード。 */
  errorCode?: string | null;
  /** 失敗や fallback の短い説明。 */
  errorSummary?: string | null;
  /** AI Gateway log ID。 */
  aiGatewayLogId?: string | null;
  /** 記録時刻。未指定時は store 実装の現在時刻を使う。 */
  now?: Date;
};

/** scope を使って assistant message へのアクセス可否を確認する入力。 */
export type CanUserAccessAssistantMessageInput = {
  /** 確認対象の assistant message ID。 */
  messageId: string;
  /** 認可確認に使う conversation scope。 */
  scope: ConversationScope;
};

/** user ID だけで assistant message へのアクセス可否を確認する入力。 */
export type CanUserAccessAssistantMessageByUserInput = {
  /** 確認対象の assistant message ID。 */
  messageId: string;
  /** 確認対象 user ID。 */
  userId: string;
};

/** assistant 回答への feedback を保存する入力。 */
export type SubmitFeedbackInput = {
  /** feedback 対象の assistant message ID。 */
  messageId: string;
  /** feedback を送信した user ID。 */
  userId: string;
  /** helpful/unhelpful の評価。 */
  rating: AiFeedbackRating;
  /** 任意の自由記述コメント。 */
  comment?: string | null;
  /** 保存時刻。未指定時は store 実装の現在時刻を使う。 */
  now?: Date;
};

/** 保存された feedback の最小応答。 */
export type SubmittedFeedback = {
  /** feedback row の ID。 */
  id: string;
  /** feedback 対象の assistant message ID。 */
  messageId: string;
  /** 保存された評価。 */
  rating: AiFeedbackRating;
};

/** retention policy に従って会話本文を削除する入力。 */
export type CleanupExpiredConversationContentInput = {
  /** 期限判定に使う基準時刻。未指定時は store 実装の現在時刻を使う。 */
  now?: Date;
};

/** conversation 単位の message 数を数える入力。 */
export type CountMessagesForConversationInput = {
  /** message 数を数える conversation ID。 */
  conversationId: string;
};

/** conversation、message、feedback、usage を永続化する store port。 */
export interface ConversationStore {
  /** conversation を作成または既存確認し、アクセス不可なら `null` を返す。 */
  ensureConversation(
    input: EnsureConversationInput,
  ): Promise<{ conversationId: string; created: boolean } | null>;
  /** user/assistant message を保存する。 */
  insertMessage(input: InsertMessageInput): Promise<StoredAssistantMessage>;
  /** AI usage event を保存し、必要な counter 更新を行う。 */
  recordUsageEvent(input: AiUsageEventInput): Promise<void>;
  /** scope 境界で assistant message へのアクセス可否を確認する。 */
  canUserAccessAssistantMessage(
    input: CanUserAccessAssistantMessageInput,
  ): Promise<{ id: string; conversationId: string } | null>;
  /** user ID 境界で assistant message へのアクセス可否を確認する。 */
  canUserAccessAssistantMessageByUser(
    input: CanUserAccessAssistantMessageByUserInput,
  ): Promise<{ id: string; conversationId: string } | null>;
  /** assistant message への feedback を保存する。 */
  submitFeedback(input: SubmitFeedbackInput): Promise<SubmittedFeedback>;
  /** retention 期限を過ぎた conversation content を削除または匿名化する。 */
  cleanupExpiredConversationContent(input?: CleanupExpiredConversationContentInput): Promise<void>;
  /** conversation 内の message 数を数える。rate limit や UI 制御で利用する。 */
  countMessagesForConversation(input: CountMessagesForConversationInput): Promise<number>;
}
