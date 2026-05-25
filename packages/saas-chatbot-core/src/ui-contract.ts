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
