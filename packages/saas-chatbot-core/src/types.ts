export type MaybePromise<T> = T | Promise<T>;

export const AI_SOURCE_KINDS = ['docs', 'specs', 'faq', 'db_summary'] as const;
export type AiSourceKind = (typeof AI_SOURCE_KINDS)[number];

export const AI_SOURCE_VISIBILITIES = [
  'public',
  'authenticated',
  'participant',
  'staff',
  'manager',
  'admin',
  'owner',
] as const;
export type AiSourceVisibility = (typeof AI_SOURCE_VISIBILITIES)[number];

export const AI_SUGGESTED_ACTION_KINDS = ['open_page', 'contact_owner', 'contact_support'] as const;
export type AiSuggestedActionKind = (typeof AI_SUGGESTED_ACTION_KINDS)[number];

export const AI_FEEDBACK_RATINGS = ['helpful', 'unhelpful'] as const;
export type AiFeedbackRating = (typeof AI_FEEDBACK_RATINGS)[number];

export type AiMessageRole = 'user' | 'assistant';

export type AiGenerationStatus =
  | 'generated'
  | 'fallback_no_grounding'
  | 'fallback_ai_unavailable'
  | 'fallback_retrieval_failed'
  | 'generation_failed';

export type AiLocale = 'ja' | 'en';

export type ChatSubjectType = 'organization' | 'classroom' | 'public_site' | 'user' | 'admin';

export type ChatRuntimeContext = {
  subjectType: ChatSubjectType;
  subjectId: string;
  actorUserId?: string | null;
  classroomId?: string | null;
  channel: string;
  locale?: string | null;
  currentPage?: string | null;
};
