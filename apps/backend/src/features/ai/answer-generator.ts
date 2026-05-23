import type { OrganizationClassroomAccess } from '../../domain/booking/authorization.js';
import { createWorkersAiAnswerModelProvider, type AiAnswerEnv } from './answer-provider.js';
import {
  buildAiSystemPrompt,
  buildAnswerPrompt,
  shouldSkipAiGatewayCache,
  type BusinessFactSummary,
  type RetrievedKnowledgeContext,
} from './prompt.js';
import type { AiSourceReference } from './source-visibility.js';

export type { AiAnswerEnv } from './answer-provider.js';

export type AiSuggestedAction = {
  label: string;
  href?: string | null;
  actionKind: 'open_page' | 'contact_owner' | 'contact_support';
};

export type GeneratedAiAnswer = {
  answer: string;
  sources: AiSourceReference[];
  suggestedActions: AiSuggestedAction[];
  confidence: number;
  needsHumanSupport: boolean;
  model: string;
  latencyMs: number;
  generationStatus:
    | 'generated'
    | 'fallback_no_grounding'
    | 'fallback_ai_unavailable'
    | 'fallback_retrieval_failed'
    | 'generation_failed';
  errorSummary?: string | null;
  aiGatewayLogId?: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const summarizeAiError = (error: unknown): string => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  return (message || 'unknown_error').slice(0, 500);
};

const clampConfidence = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 50;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const sanitizeSuggestedActionHref = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const candidate = value.trim();
  // 提案アクションはモデル出力なので、任意の外部遷移先を作れないよう
  // 同一アプリ内の相対リンクだけを許可する。
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return null;
  }

  try {
    const url = new URL(candidate, 'https://reserve-app.local');
    if (url.origin !== 'https://reserve-app.local') {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};

const normalizeSuggestedActions = (value: unknown): AiSuggestedAction[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const actions: AiSuggestedAction[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.label !== 'string') {
      continue;
    }
    const actionKind =
      entry.actionKind === 'open_page' ||
      entry.actionKind === 'contact_owner' ||
      entry.actionKind === 'contact_support'
        ? entry.actionKind
        : 'contact_support';
    actions.push({
      label: entry.label.slice(0, 80),
      href: sanitizeSuggestedActionHref(entry.href),
      actionKind,
    });
  }
  return actions;
};

const buildAnswerSources = ({
  retrievedContexts,
  businessFacts,
}: {
  retrievedContexts: RetrievedKnowledgeContext[];
  businessFacts: BusinessFactSummary | null;
}): AiSourceReference[] => {
  const sources: AiSourceReference[] = retrievedContexts.map((context) => ({
    sourceKind: context.sourceKind,
    title: context.title,
    sourcePath: context.sourcePath ?? null,
    chunkId: context.chunkId ?? null,
    visibility: context.visibility,
  }));

  if (businessFacts?.factKeys.length) {
    sources.push({
      sourceKind: 'db_summary',
      title: '現在の業務データ',
      sourcePath: null,
      chunkId: businessFacts.factKeys.join(','),
      visibility: 'authenticated',
    });
  }

  return sources;
};

const parseAnswerPayload = (result: unknown): Partial<GeneratedAiAnswer> => {
  const rawText = (() => {
    if (typeof result === 'string') {
      return result;
    }
    if (isRecord(result)) {
      if (typeof result.response === 'string') {
        return result.response;
      }
      if (typeof result.result === 'string') {
        return result.result;
      }
      if (typeof result.text === 'string') {
        return result.text;
      }
    }
    return '';
  })();

  if (!rawText.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (isRecord(parsed)) {
      return {
        answer: typeof parsed.answer === 'string' ? parsed.answer : rawText,
        confidence: clampConfidence(parsed.confidence),
        needsHumanSupport: parsed.needsHumanSupport === true,
        suggestedActions: normalizeSuggestedActions(parsed.suggestedActions),
      };
    }
  } catch {
    // プロバイダーがプレーンテキストだけを返した場合も受け入れ、下で応答形式に包む。
  }

  return {
    answer: rawText,
  };
};

const defaultSuggestedActions = ({
  access,
  needsHumanSupport,
}: {
  access: OrganizationClassroomAccess;
  needsHumanSupport: boolean;
}): AiSuggestedAction[] => {
  if (needsHumanSupport) {
    return access.facts.orgRole === 'owner'
      ? [{ label: 'サポートへ相談する', actionKind: 'contact_support' }]
      : [{ label: 'ownerに確認する', actionKind: 'contact_owner' }];
  }

  if (access.effective.canManageBookings) {
    return [{ label: '予約運用を開く', href: '/admin/bookings', actionKind: 'open_page' }];
  }

  if (access.effective.canUseParticipantBooking) {
    return [{ label: '予約確認を開く', href: '/participant/bookings', actionKind: 'open_page' }];
  }

  return [{ label: 'サポートへ相談する', actionKind: 'contact_support' }];
};

/**
 * 許可済みの検索済みナレッジと、回答時点の業務事実から回答を生成する。
 *
 * 根拠不足、検索失敗、Workers AI 利用不可のときも、呼び出し側が
 * 監査可能なアシスタントメッセージを保存できるよう、決定的な代替 payload を返す。
 */
export const generateAnswer = async ({
  env,
  userId,
  access,
  currentPage,
  message,
  retrievedContexts,
  businessFacts,
  retrievalErrorSummary,
}: {
  env: AiAnswerEnv;
  userId: string;
  access: OrganizationClassroomAccess;
  currentPage?: string | null;
  message: string;
  retrievedContexts: RetrievedKnowledgeContext[];
  businessFacts: BusinessFactSummary | null;
  retrievalErrorSummary?: string | null;
}): Promise<GeneratedAiAnswer> => {
  const sources = buildAnswerSources({ retrievedContexts, businessFacts });
  const hasGrounding = retrievedContexts.length > 0 || Boolean(businessFacts?.factKeys.length);
  const answerProvider = createWorkersAiAnswerModelProvider({ env });
  const model = answerProvider.model;

  if (retrievalErrorSummary) {
    return {
      answer:
        'ナレッジ検索が一時的に利用できないため、断定できません。表示中の画面を確認し、必要に応じてownerまたはサポートへ確認してください。',
      sources,
      suggestedActions: defaultSuggestedActions({ access, needsHumanSupport: true }),
      confidence: 30,
      needsHumanSupport: true,
      model,
      latencyMs: 0,
      generationStatus: 'fallback_retrieval_failed',
      errorSummary: retrievalErrorSummary,
    };
  }

  if (!hasGrounding || !answerProvider.isConfigured) {
    // 検索済み文書や許可済み DB 由来の事実がない状態で業務案内を作らない。
    // AI binding 不足は、根拠がある場合だけやや軽い代替応答として扱う。
    const answer = hasGrounding
      ? '現在の情報を確認しましたが、AI回答生成が一時的に利用できません。表示中の画面または管理者に確認してください。'
      : '確認できる根拠が見つからないため、断定できません。ownerまたはサポートへ確認してください。';
    return {
      answer,
      sources,
      suggestedActions: defaultSuggestedActions({ access, needsHumanSupport: true }),
      confidence: hasGrounding ? 45 : 20,
      needsHumanSupport: true,
      model,
      latencyMs: 0,
      generationStatus: hasGrounding ? 'fallback_ai_unavailable' : 'fallback_no_grounding',
      errorSummary: hasGrounding ? 'workers_ai_binding_not_configured' : null,
    };
  }

  let generation: Awaited<ReturnType<typeof answerProvider.generate>>;
  const generationStartedAt = Date.now();
  try {
    generation = await answerProvider.generate({
      model,
      messages: [
        { role: 'system', content: buildAiSystemPrompt() },
        {
          role: 'user',
          content: buildAnswerPrompt({
            userId,
            access,
            currentPage,
            retrievedContexts,
            businessFacts,
            message,
          }),
        },
      ],
      skipCache: shouldSkipAiGatewayCache(message, businessFacts),
      cacheTtl: shouldSkipAiGatewayCache(message, businessFacts) ? undefined : 60,
      // 組織・教室のメタデータは AI Gateway の観測用に限定し、
      // プロンプト側にはアクセスフィルター済みの業務コンテキストだけを渡す。
      metadata: {
        organizationId: access.organizationId,
        classroomId: access.classroomId,
      },
    });
  } catch (error) {
    console.warn('[ai-chat] answer generation failed', error);
    return {
      answer:
        '現在の情報を確認しましたが、AI回答生成が一時的に利用できません。表示中の画面または管理者に確認してください。',
      sources,
      suggestedActions: defaultSuggestedActions({ access, needsHumanSupport: true }),
      confidence: 35,
      needsHumanSupport: true,
      model,
      latencyMs: Date.now() - generationStartedAt,
      generationStatus: 'generation_failed',
      errorSummary: summarizeAiError(error),
      aiGatewayLogId: answerProvider.readAiGatewayLogId(null),
    };
  }

  const parsed = parseAnswerPayload(generation.result);
  const confidence = clampConfidence(parsed.confidence ?? (hasGrounding ? 70 : 20));
  const needsHumanSupport = parsed.needsHumanSupport === true || confidence < 50;

  return {
    answer:
      parsed.answer?.trim() ||
      '確認できる情報をもとに回答を作成できませんでした。ownerまたはサポートへ確認してください。',
    sources,
    suggestedActions:
      parsed.suggestedActions && parsed.suggestedActions.length > 0
        ? parsed.suggestedActions
        : defaultSuggestedActions({ access, needsHumanSupport }),
    confidence,
    needsHumanSupport,
    model,
    latencyMs: generation.latencyMs,
    generationStatus: 'generated',
    errorSummary: null,
    aiGatewayLogId: generation.aiGatewayLogId,
  };
};
