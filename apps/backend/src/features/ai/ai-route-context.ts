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
  type OrganizationStoreAccess,
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

/** AI route が参照する Workers AI、Vectorize、AI Gateway、認証環境変数の合成型。 */
export type AiRoutesEnv = AuthRuntimeEnv & AiAnswerEnv & AiRetrieverEnv;

/** Internal AI endpoint の operator check 結果。HTTP status と同じ値で扱う。 */
export type InternalOperatorAccessResult = { status: 200 | 401 | 403 };

/** AI route で request header と任意の組織・店舗・画面文脈から access context を解決する入力。 */
export type ResolveAiRouteRequestContextInput = {
  headers: Headers;
  organizationId?: string | null;
  storeId?: string | null;
  currentPage?: string | null;
};

/** AI chat 完了時に Sentry breadcrumb へ残す認可済み文脈と生成結果。 */
export type AiChatBreadcrumbInput = {
  access: OrganizationStoreAccess;
  generated: GeneratedAiAnswer;
  retrievalErrorSummary?: string | null;
  durationMs: number;
};

/**
 * AI route handler が利用する依存を 1 箇所に集約した context。
 *
 * 認可、RAG 検索、business facts、回答生成、rate limit、source sanitization を
 * route 層から差し替えやすくし、テストでは同じ境界を mock する。
 */
export type AiRouteContext = {
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AiRoutesEnv;
  resolveRequestContext(input: ResolveAiRouteRequestContextInput): Promise<AiRequestContext | null>;
  conversationStore: ConversationStore;
  observabilityStore: ReturnType<typeof createDrizzleAiObservabilityStore>;
  retrieveKnowledge(
    input: RetrieveKnowledgeInput<OrganizationStoreAccess>,
  ): Promise<RetrievedKnowledgeChunk[]>;
  resolveBusinessFacts(input: { access: OrganizationStoreAccess }): Promise<BusinessFactSummary>;
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
    access: OrganizationStoreAccess;
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

/**
 * D1-backed store と AI provider を組み合わせた AI route context を作成する。
 *
 * @param input - AI route の依存。
 * @param input.auth - Better Auth instance。
 * @param input.database - Conversation、usage、knowledge lookup に使う database。
 * @param input.env - Workers AI、Vectorize、AI Gateway、認証の環境変数。
 * @returns AI chat と internal AI route が共有する context。
 */
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
        storeId: input.storeId,
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
          storeId: access.storeId,
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
