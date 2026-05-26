import type { AiFeedbackRating, AiGenerationStatus, AiMessageRole } from './types.js';
import type { AiSourceReference } from './ui-contract.js';

export type ConversationScope = {
  userId: string;
  organizationId: string;
  classroomId: string | null;
};

export type StoredAssistantMessage = {
  id: string;
  conversationId: string;
};

export type EnsureConversationInput = {
  conversationId?: string | null;
  scope: ConversationScope;
  title?: string | null;
  now?: Date;
};

export type InsertMessageInput = {
  conversationId: string;
  role: AiMessageRole;
  content: string;
  sources?: AiSourceReference[] | null;
  retrievedContext?: unknown;
  confidence?: number | null;
  needsHumanSupport?: boolean;
  aiGatewayLogId?: string | null;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  generationStatus?: AiGenerationStatus | string | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  now?: Date;
};

export type AiUsageEventInput = {
  scope: ConversationScope;
  conversationId: string;
  messageId: string;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  generationStatus: AiGenerationStatus | string;
  errorCode?: string | null;
  errorSummary?: string | null;
  aiGatewayLogId?: string | null;
  now?: Date;
};

export type CanUserAccessAssistantMessageInput = {
  messageId: string;
  scope: ConversationScope;
};

export type CanUserAccessAssistantMessageByUserInput = {
  messageId: string;
  userId: string;
};

export type SubmitFeedbackInput = {
  messageId: string;
  userId: string;
  rating: AiFeedbackRating;
  comment?: string | null;
  now?: Date;
};

export type SubmittedFeedback = {
  id: string;
  messageId: string;
  rating: AiFeedbackRating;
};

export type CleanupExpiredConversationContentInput = {
  now?: Date;
};

export type CountMessagesForConversationInput = {
  conversationId: string;
};

export interface ConversationStore {
  ensureConversation(
    input: EnsureConversationInput,
  ): Promise<{ conversationId: string; created: boolean } | null>;
  insertMessage(input: InsertMessageInput): Promise<StoredAssistantMessage>;
  recordUsageEvent(input: AiUsageEventInput): Promise<void>;
  canUserAccessAssistantMessage(
    input: CanUserAccessAssistantMessageInput,
  ): Promise<{ id: string; conversationId: string } | null>;
  canUserAccessAssistantMessageByUser(
    input: CanUserAccessAssistantMessageByUserInput,
  ): Promise<{ id: string; conversationId: string } | null>;
  submitFeedback(input: SubmitFeedbackInput): Promise<SubmittedFeedback>;
  cleanupExpiredConversationContent(input?: CleanupExpiredConversationContentInput): Promise<void>;
  countMessagesForConversation(input: CountMessagesForConversationInput): Promise<number>;
}
