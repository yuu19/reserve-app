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

export type AiSourceReference = {
  sourceKind: AiSourceKind;
  title: string;
  sourcePath?: string | null;
  chunkId?: string | null;
  visibility?: AiSourceVisibility;
};

export type AiSuggestedAction = {
  label: string;
  href?: string | null;
  actionKind: AiSuggestedActionKind;
};

export type AiChatRequest = {
  message: string;
  conversationId?: string;
  organizationId?: string;
  classroomId?: string;
  currentPage?: string;
};

export type AiChatResponse = {
  conversationId: string;
  messageId: string;
  answer: string;
  sources: AiSourceReference[];
  suggestedActions: AiSuggestedAction[];
  confidence: number;
  needsHumanSupport: boolean;
  rateLimit: {
    userRemainingThisHour: number;
    organizationRemainingToday: number;
  };
};

export type AiFeedbackRequest = {
  rating: AiFeedbackRating;
  comment?: string;
};

export type AiFeedbackResponse = {
  feedbackId: string;
  messageId: string;
  rating: AiFeedbackRating;
};

export type AiChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: AiSourceReference[];
  suggestedActions?: AiSuggestedAction[];
  confidence?: number;
  needsHumanSupport?: boolean;
  feedbackRating?: AiFeedbackRating | null;
  feedbackStatus?: 'idle' | 'sending' | 'sent' | 'failed';
  feedbackError?: string | null;
  createdAt: Date;
};

export type AiChatContext = {
  organizationId?: string | null;
  classroomId?: string | null;
  currentPage?: string | null;
};
