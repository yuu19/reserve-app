/** 同期実装と非同期実装の両方を許す境界の戻り値。 */
export type MaybePromise<T> = T | Promise<T>;

/** ナレッジ参照元の由来分類として許可する値。 */
export const AI_SOURCE_KINDS = ['docs', 'specs', 'faq', 'db_summary'] as const;
/** ナレッジ参照元の由来分類。 */
export type AiSourceKind = (typeof AI_SOURCE_KINDS)[number];

/** 参照元の最小公開範囲として許可する値。 */
export const AI_SOURCE_VISIBILITIES = [
  'public',
  'authenticated',
  'participant',
  'staff',
  'manager',
  'admin',
  'owner',
] as const;
/** 参照元の公開範囲と権限に応じたナレッジ検索に使う値。 */
export type AiSourceVisibility = (typeof AI_SOURCE_VISIBILITIES)[number];

/** UI に提示できる suggested action の分類。 */
export const AI_SUGGESTED_ACTION_KINDS = ['open_page', 'contact_owner', 'contact_support'] as const;
/** UI suggested action の分類。 */
export type AiSuggestedActionKind = (typeof AI_SUGGESTED_ACTION_KINDS)[number];

/** assistant 回答 feedback の許可値。 */
export const AI_FEEDBACK_RATINGS = ['helpful', 'unhelpful'] as const;
/** assistant 回答 feedback の評価。 */
export type AiFeedbackRating = (typeof AI_FEEDBACK_RATINGS)[number];

/** conversation message の送信者 role。 */
export type AiMessageRole = 'user' | 'assistant';

/** 回答生成の成功・代替応答・失敗を UI と usage log が共有する分類。 */
export type AiGenerationStatus =
  | 'generated'
  | 'fallback_no_grounding'
  | 'fallback_ai_unavailable'
  | 'fallback_retrieval_failed'
  | 'generation_failed';

/** knowledge document や UI request の locale。 */
export type AiLocale = 'ja' | 'en';

/** chatbot の subject scope。 */
export type ChatSubjectType = 'organization' | 'store' | 'public_site' | 'user' | 'admin';

/** chatbot core の境界に渡す実行時の文脈。 */
export type ChatRuntimeContext = {
  /** 現在の subject 種別。 */
  subjectType: ChatSubjectType;
  /** 現在の subject ID。 */
  subjectId: string;
  /** 操作している user ID。匿名や system 起点では `null`。 */
  actorUserId?: string | null;
  /** store 文脈がある場合の store ID。 */
  storeId?: string | null;
  /** web chat、admin tool など呼び出し元 channel。 */
  channel: string;
  /** UI または browser locale。 */
  locale?: string | null;
  /** 質問時の画面 path。 */
  currentPage?: string | null;
};
