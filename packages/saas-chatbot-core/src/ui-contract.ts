import type {
  AiFeedbackRating,
  AiSourceKind,
  AiSourceVisibility,
  AiSuggestedActionKind,
} from './types.js';

export {
  AI_FEEDBACK_RATINGS,
  AI_SOURCE_KINDS,
  AI_SOURCE_VISIBILITIES,
  AI_SUGGESTED_ACTION_KINDS,
} from './types.js';
export type {
  AiFeedbackRating,
  AiSourceKind,
  AiSourceVisibility,
  AiSuggestedActionKind,
} from './types.js';

/** API response と UI message が共有する参照元表示情報。 */
export type AiSourceReference = {
  /** 参照元の由来分類。 */
  sourceKind: AiSourceKind;
  /** 利用者に表示する参照元 title。 */
  title: string;
  /** 参照元を開ける場合の path。非表示の参照元では `null`。 */
  sourcePath?: string | null;
  /** 参照した knowledge chunk ID。 */
  chunkId?: string | null;
  /** 参照元の公開範囲。 */
  visibility?: AiSourceVisibility;
};

/** 回答後に UI が提示する次アクション。 */
export type AiSuggestedAction = {
  /** ボタンやリンクに表示するラベル。 */
  label: string;
  /** 遷移先 URL。外部 action の場合は `null`。 */
  href?: string | null;
  /** UI が action を分岐する分類。 */
  actionKind: AiSuggestedActionKind;
};

/** chat API に送る利用者質問。 */
export type AiChatRequest = {
  /** 利用者の質問本文。 */
  message: string;
  /** 継続したい conversation ID。新規会話では省略可能。 */
  conversationId?: string;
  /** organization 文脈で質問する場合の organization ID。 */
  organizationId?: string;
  /** classroom 文脈で質問する場合の classroom ID。 */
  classroomId?: string;
  /** 質問時の画面 path。 */
  currentPage?: string;
};

/** chat API が UI に返す assistant 回答。 */
export type AiChatResponse = {
  /** 回答が属する conversation ID。 */
  conversationId: string;
  /** 保存された assistant message ID。 */
  messageId: string;
  /** 利用者へ表示する回答本文。 */
  answer: string;
  /** 回答根拠として表示できる参照元。 */
  sources: AiSourceReference[];
  /** 回答後に UI が提示できる次アクション。 */
  suggestedActions: AiSuggestedAction[];
  /** 根拠との対応と生成品質を 0-1 の範囲で示す信頼度。 */
  confidence: number;
  /** 人によるサポートへ誘導すべき場合は `true`。 */
  needsHumanSupport: boolean;
  /** 回答後の残り利用回数。 */
  rateLimit: {
    /** user の時間あたり残り送信数。 */
    userRemainingThisHour: number;
    /** organization の日次残り送信数。 */
    organizationRemainingToday: number;
  };
};

/** assistant 回答への feedback API request。 */
export type AiFeedbackRequest = {
  /** helpful/unhelpful の評価。 */
  rating: AiFeedbackRating;
  /** 任意の自由記述コメント。 */
  comment?: string;
};

/** feedback API が UI に返す保存結果。 */
export type AiFeedbackResponse = {
  /** 保存された feedback ID。 */
  feedbackId: string;
  /** feedback 対象の assistant message ID。 */
  messageId: string;
  /** 保存された評価。 */
  rating: AiFeedbackRating;
};

/** web chat widget の表示・送信状態。 */
export type AiChatUiStatus = 'closed' | 'ready' | 'sending' | 'error';

/** chat client が UI に渡す正規化済み error payload。 */
export type AiChatClientErrorPayload = {
  /** error の発生層。 */
  kind: 'api' | 'network' | 'parse';
  /** 利用者または開発者向けに表示できる短い説明。 */
  message: string;
  /** API error の HTTP status。 */
  status?: number;
  /** API error の HTTP status text。 */
  statusText?: string;
  /** rate limit などで再試行可能になるまでの秒数。 */
  retryAfterSeconds?: number;
};

/** web chat UI が描画する message。 */
export type AiChatMessage = {
  /** UI 内の message ID。 */
  id: string;
  /** message の送信者 role。 */
  role: 'user' | 'assistant';
  /** 表示する message 本文。 */
  content: string;
  /** assistant message に表示する参照元。 */
  sources?: AiSourceReference[];
  /** assistant message に表示する suggested action。 */
  suggestedActions?: AiSuggestedAction[];
  /** assistant message の信頼度。 */
  confidence?: number;
  /** 人によるサポートへ誘導すべきかどうか。 */
  needsHumanSupport?: boolean;
  /** 現在 user が付けた feedback。 */
  feedbackRating?: AiFeedbackRating | null;
  /** feedback 送信 UI の状態。 */
  feedbackStatus?: 'idle' | 'sending' | 'sent' | 'failed';
  /** feedback 送信失敗時の表示用 error。 */
  feedbackError?: string | null;
  /** UI に表示する作成時刻。 */
  createdAt: Date;
};

/** web chat widget を mount するときの context。 */
export type AiChatContext = {
  /** organization 文脈の ID。 */
  organizationId?: string | null;
  /** classroom 文脈の ID。 */
  classroomId?: string | null;
  /** widget を開いた画面 path。 */
  currentPage?: string | null;
};
