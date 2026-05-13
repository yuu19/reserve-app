import type { OrganizationClassroomAccess } from '../booking/authorization.js';
import {
  buildAiSystemPrompt,
  buildAnswerPrompt,
  shouldSkipAiGatewayCache,
  type BusinessFactSummary,
  type RetrievedKnowledgeContext,
} from './prompt.js';
import type { AiSourceReference } from './source-visibility.js';

export type AiAnswerEnv = {
  AI?: {
    run: (
      model: string,
      inputs: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
  AI_ANSWER_MODEL?: string;
  AI_GATEWAY_ID?: string;
};

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
  aiGatewayLogId?: string | null;
};

const DEFAULT_ANSWER_MODEL = '@cf/meta/llama-3.1-8b-instruct';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

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
    // Plain text provider output is accepted and wrapped below.
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

export const generateAnswer = async ({
  env,
  userId,
  access,
  currentPage,
  message,
  retrievedContexts,
  businessFacts,
}: {
  env: AiAnswerEnv;
  userId: string;
  access: OrganizationClassroomAccess;
  currentPage?: string | null;
  message: string;
  retrievedContexts: RetrievedKnowledgeContext[];
  businessFacts: BusinessFactSummary | null;
}): Promise<GeneratedAiAnswer> => {
  const sources = buildAnswerSources({ retrievedContexts, businessFacts });
  const hasGrounding = retrievedContexts.length > 0 || Boolean(businessFacts?.factKeys.length);

  if (!hasGrounding || !env.AI) {
    const answer = hasGrounding
      ? '現在の情報を確認しましたが、AI回答生成が一時的に利用できません。表示中の画面または管理者に確認してください。'
      : '確認できる根拠が見つからないため、断定できません。ownerまたはサポートへ確認してください。';
    return {
      answer,
      sources,
      suggestedActions: defaultSuggestedActions({ access, needsHumanSupport: true }),
      confidence: hasGrounding ? 45 : 20,
      needsHumanSupport: true,
    };
  }

  let result: unknown;
  try {
    result = await env.AI.run(
      env.AI_ANSWER_MODEL?.trim() || DEFAULT_ANSWER_MODEL,
      {
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
      },
      env.AI_GATEWAY_ID
        ? {
            gateway: {
              id: env.AI_GATEWAY_ID,
              skipCache: shouldSkipAiGatewayCache(message, businessFacts),
              cacheTtl: shouldSkipAiGatewayCache(message, businessFacts) ? undefined : 60,
              metadata: {
                purpose: 'ai-chat-answer',
                organizationId: access.organizationId,
                classroomId: access.classroomId,
              },
            },
          }
        : undefined,
    );
  } catch (error) {
    console.warn('[ai-chat] answer generation failed', error);
    return {
      answer:
        '現在の情報を確認しましたが、AI回答生成が一時的に利用できません。表示中の画面または管理者に確認してください。',
      sources,
      suggestedActions: defaultSuggestedActions({ access, needsHumanSupport: true }),
      confidence: 35,
      needsHumanSupport: true,
    };
  }

  const parsed = parseAnswerPayload(result);
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
  };
};
