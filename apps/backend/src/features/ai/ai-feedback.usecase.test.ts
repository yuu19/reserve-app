import { describe, expect, it, vi } from 'vitest';
import type { OrganizationClassroomAccess } from '../../domain/booking/authorization.js';
import type { AiRequestContext } from './context-resolver.js';
import type { AiRouteContext } from './ai-route-context.js';
import { submitAiMessageFeedback } from './ai-feedback.usecase.js';

const access: OrganizationClassroomAccess = {
  organizationId: 'org-a',
  organizationSlug: 'org-a',
  organizationName: 'Org A',
  classroomId: 'class-a',
  classroomSlug: 'class-a',
  classroomName: 'Class A',
  facts: {
    orgRole: null,
    classroomStaffRole: null,
    hasParticipantRecord: true,
  },
  effective: {
    canManageOrganization: false,
    canManageClassroom: false,
    canManageBookings: false,
    canManageParticipants: false,
    canUseParticipantBooking: true,
  },
  sources: {
    canManageOrganization: null,
    canManageClassroom: null,
    canManageBookings: null,
    canManageParticipants: null,
    canUseParticipantBooking: 'participant_record',
  },
  display: {
    primaryRole: 'participant',
    badges: ['participant'],
  },
};

const requestContext: AiRequestContext = {
  identity: {
    userId: 'user-a',
    email: 'participant@example.com',
    activeOrganizationId: 'org-a',
  },
  access,
  runtimeContext: {
    subjectType: 'organization',
    subjectId: 'org-a',
    actorUserId: 'user-a',
    classroomId: 'class-a',
    channel: 'web',
    locale: 'ja',
    currentPage: null,
  },
  allowedVisibilities: ['public', 'authenticated', 'participant'],
  internalOperator: false,
  currentPage: null,
};

const createConversationStore = (
  overrides: Partial<AiRouteContext['conversationStore']> = {},
): AiRouteContext['conversationStore'] =>
  ({
    ensureConversation: vi.fn(),
    insertMessage: vi.fn(),
    canUserAccessAssistantMessage: vi.fn(async () => ({
      id: 'message-a',
      conversationId: 'conversation-a',
    })),
    submitFeedback: vi.fn(async () => ({
      id: 'feedback-a',
      messageId: 'message-a',
      rating: 'helpful',
    })),
    cleanupExpiredConversationContent: vi.fn(),
    countMessagesForConversation: vi.fn(),
    ...overrides,
  }) as AiRouteContext['conversationStore'];

const createContext = (overrides: Partial<AiRouteContext> = {}): AiRouteContext => ({
  auth: {} as never,
  database: {} as never,
  env: {},
  resolveRequestContext: vi.fn(async () => requestContext),
  conversationStore: createConversationStore(),
  observabilityStore: {
    listKnowledgeStatuses: vi.fn(),
    listFeedbackThemes: vi.fn(),
  },
  retrieveKnowledge: vi.fn(),
  resolveBusinessFacts: vi.fn(),
  generateAnswer: vi.fn(),
  checkAndIncrementUsage: vi.fn(),
  sanitizeSourceReference: vi.fn(),
  ensureInternalOperator: vi.fn(),
  recordChatBreadcrumb: vi.fn(),
  ...overrides,
});

describe('submitAiMessageFeedback', () => {
  it('returns 403 when the assistant message is outside the current scope', async () => {
    const submitFeedback = vi.fn();
    const ctx = createContext({
      conversationStore: createConversationStore({
        canUserAccessAssistantMessage: vi.fn(async () => null),
        submitFeedback,
      }),
    });

    await expect(
      submitAiMessageFeedback({
        ctx,
        params: { messageId: 'message-other' },
        body: { rating: 'unhelpful', comment: '違う会話です' },
        headers: new Headers(),
      }),
    ).resolves.toEqual({
      status: 403,
      body: {
        message: 'Forbidden.',
      },
    });
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it('upserts feedback for an assistant message in the current scope', async () => {
    const submitFeedback = vi.fn(async () => ({
      id: 'feedback-a',
      messageId: 'message-a',
      rating: 'helpful',
    }));
    const ctx = createContext({
      conversationStore: createConversationStore({ submitFeedback }),
    });

    await expect(
      submitAiMessageFeedback({
        ctx,
        params: { messageId: 'message-a' },
        body: { rating: 'helpful', comment: '助かりました' },
        headers: new Headers(),
      }),
    ).resolves.toEqual({
      status: 200,
      body: {
        feedbackId: 'feedback-a',
        messageId: 'message-a',
        rating: 'helpful',
      },
    });
    expect(submitFeedback).toHaveBeenCalledWith({
      messageId: 'message-a',
      userId: 'user-a',
      rating: 'helpful',
      comment: '助かりました',
    });
  });
});
