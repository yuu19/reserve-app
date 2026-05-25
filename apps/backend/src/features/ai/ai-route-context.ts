import * as Sentry from '@sentry/cloudflare';
import type {
  AiGeneratedSourceReference,
  AiSourceReference,
  AiUsageLimitResult,
  ConversationStore,
  RetrievedKnowledgeChunk,
  RetrieveKnowledgeInput,
} from '@repo/saas-chatbot-core';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import {
  getSessionIdentity,
  type OrganizationClassroomAccess,
} from '../../domain/booking/authorization.js';
import { canAccessInternalBillingInspection } from '../../domain/billing/internal-operator-access.js';
import { createDrizzleAiKnowledgeRetriever } from '../../infra/ai-knowledge/drizzle-ai-knowledge-retriever.js';
import { createDrizzleAiConversationStore } from '../../infra/ai-knowledge/drizzle-ai-conversation-store.js';
import { createDrizzleAiObservabilityStore } from '../../infra/ai-knowledge/drizzle-ai-observability-store.js';
import { generateAnswer, type AiAnswerEnv, type GeneratedAiAnswer } from './answer-generator.js';
import { createReserveAppBusinessFactsProvider } from './business-facts.js';
import { resolveAiRequestContext, type AiRequestContext } from './context-resolver.js';
import { createReserveAppChatRateLimiter } from './rate-limit.js';
import { type AiRetrieverEnv } from './retriever.js';
import { reserveAppPromptBuilder } from './prompt.js';
import { reserveAppSourceVisibilityPolicy } from './source-visibility.js';
import type { BusinessFactSummary } from './prompt.js';

export type AiRoutesEnv = AuthRuntimeEnv & AiAnswerEnv & AiRetrieverEnv;

export type InternalOperatorAccessResult = { status: 200 | 401 | 403 };

export type ResolveAiRouteRequestContextInput = {
  headers: Headers;
  organizationId?: string | null;
  classroomId?: string | null;
  currentPage?: string | null;
};

export type AiChatBreadcrumbInput = {
  access: OrganizationClassroomAccess;
  generated: GeneratedAiAnswer;
  retrievalErrorSummary?: string | null;
  durationMs: number;
};

export type AiRouteContext = {
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AiRoutesEnv;
  resolveRequestContext(input: ResolveAiRouteRequestContextInput): Promise<AiRequestContext | null>;
  conversationStore: ConversationStore;
  observabilityStore: ReturnType<typeof createDrizzleAiObservabilityStore>;
  retrieveKnowledge(
    input: RetrieveKnowledgeInput<OrganizationClassroomAccess>,
  ): Promise<RetrievedKnowledgeChunk[]>;
  resolveBusinessFacts(input: {
    access: OrganizationClassroomAccess;
  }): Promise<BusinessFactSummary>;
  generateAnswer(
    input: Omit<Parameters<typeof generateAnswer>[0], 'env'>,
  ): ReturnType<typeof generateAnswer>;
  checkAndIncrementUsage(input: {
    userId: string;
    organizationId: string;
    now?: Date;
  }): Promise<AiUsageLimitResult>;
  sanitizeSourceReference(input: {
    source: AiGeneratedSourceReference;
    access: OrganizationClassroomAccess;
    internalOperator?: boolean;
  }): AiSourceReference | null;
  ensureInternalOperator(input: { headers: Headers }): Promise<InternalOperatorAccessResult>;
  recordChatBreadcrumb(input: AiChatBreadcrumbInput): void;
};

type CreateAiRouteContextInput = {
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AiRoutesEnv;
};

const getSessionEmailVerified = (session: unknown): boolean => {
  if (typeof session !== 'object' || session === null) {
    return false;
  }
  const user = (session as Record<string, unknown>).user;
  if (typeof user !== 'object' || user === null) {
    return false;
  }
  return (user as Record<string, unknown>).emailVerified === true;
};

export const createAiRouteContext = ({
  auth,
  database,
  env,
}: CreateAiRouteContextInput): AiRouteContext => {
  const conversationStore = createDrizzleAiConversationStore({ database });
  const observabilityStore = createDrizzleAiObservabilityStore({ database });
  const knowledgeRetriever = createDrizzleAiKnowledgeRetriever({
    env,
    database,
    sourceVisibilityPolicy: reserveAppSourceVisibilityPolicy,
  });
  const businessFactsProvider = createReserveAppBusinessFactsProvider({ database });
  const rateLimiter = createReserveAppChatRateLimiter({ database });

  return {
    auth,
    database,
    env,
    conversationStore,
    observabilityStore,

    resolveRequestContext(input) {
      return resolveAiRequestContext({
        auth,
        database,
        env,
        headers: input.headers,
        organizationId: input.organizationId,
        classroomId: input.classroomId,
        currentPage: input.currentPage,
      });
    },

    retrieveKnowledge(input) {
      return knowledgeRetriever.retrieveKnowledge(input);
    },

    resolveBusinessFacts(input) {
      return businessFactsProvider.getFacts(input.access);
    },

    generateAnswer(input) {
      return generateAnswer({
        env,
        promptBuilder: reserveAppPromptBuilder,
        ...input,
      });
    },

    checkAndIncrementUsage(input) {
      return rateLimiter.checkAndIncrement({
        actorUserId: input.userId,
        subjectType: 'organization',
        subjectId: input.organizationId,
        now: input.now,
      });
    },

    sanitizeSourceReference(input) {
      return reserveAppSourceVisibilityPolicy.sanitizeSourceReference({
        source: input.source,
        context: input.access,
        internalOperator: input.internalOperator,
      });
    },

    async ensureInternalOperator({ headers }) {
      const [identity, session] = await Promise.all([
        getSessionIdentity(auth, headers),
        auth.api.getSession({ headers }),
      ]);
      if (!identity) {
        return { status: 401 };
      }
      if (
        !canAccessInternalBillingInspection({
          env,
          email: identity.email,
          emailVerified: getSessionEmailVerified(session),
        })
      ) {
        return { status: 403 };
      }
      return { status: 200 };
    },

    recordChatBreadcrumb({ access, generated, retrievalErrorSummary, durationMs }) {
      Sentry.addBreadcrumb({
        category: 'ai.chat',
        level: 'info',
        data: {
          organizationId: access.organizationId,
          classroomId: access.classroomId,
          confidence: generated.confidence,
          needsHumanSupport: generated.needsHumanSupport,
          provider: generated.provider,
          model: generated.model,
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
          aiGatewayLogId: generated.aiGatewayLogId,
          generationStatus: generated.generationStatus,
          latencyMs: generated.latencyMs,
          errorCode: generated.errorCode,
          hasAiError: Boolean(generated.errorSummary),
          retrievalFailed: Boolean(retrievalErrorSummary),
          durationMs,
        },
      });
    },
  };
};
