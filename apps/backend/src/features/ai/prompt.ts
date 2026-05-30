import type {
  BusinessFactSummary,
  PromptBuilder,
  RetrievedKnowledgeContext,
} from '@repo/saas-chatbot-core';
import type { OrganizationStoreAccess } from '../../domain/booking/authorization.js';

export type { BusinessFactSummary, RetrievedKnowledgeContext } from '@repo/saas-chatbot-core';

/** プロンプトや保存用概要に入る前に、高リスクな secret と支払い参照情報をマスクする。 */
export const redactSensitiveText = (value: string): string =>
  value
    .replace(/sk_(live|test)_[A-Za-z0-9_]+/g, '[redacted-secret]')
    .replace(
      /(invoice|receipt|payment|card|stripe)[^\n]{0,80}(https?:\/\/\S+)/giu,
      '$1 [redacted-url]',
    )
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[redacted-card-number]');

/**
 * Reserve App の AI 回答で必ず守るシステム指示を生成する。
 *
 * @returns 権限外情報の非開示、操作代行の禁止、根拠不足時の案内方針を含む system prompt。
 */
export const buildAiSystemPrompt = (): string =>
  [
    'あなたは reserve-app のAIサポートです。',
    '回答は日本語を既定にし、根拠がある内容だけを案内してください。',
    '予約作成、課金変更、参加者変更、チケット付与、招待送信などの操作は実行せず、利用者が開ける画面や確認手順だけを案内してください。',
    'ユーザーの権限外の情報、内部仕様、請求書、領収書、支払い方法、秘密情報、外部サービスの生ペイロード、私的な監査情報は出してはいけません。',
    '根拠がない、根拠が矛盾する、または権限が不足する場合は断定せず、ownerまたはsupportへ確認する導線を示してください。',
    '回答は簡潔にし、既存の予約、参加者、招待、チケット、課金、権限の用語を使ってください。',
  ].join('\n');

/**
 * 回答生成時に参照できるユーザー権限と画面文脈を prompt 用に整形する。
 *
 * @param input - 認可済みユーザーと organization/store access の文脈。
 * @param input.userId - 質問したログインユーザー ID。
 * @param input.access - route 側で解決済みの organization/store access。
 * @param input.currentPage - UI から渡された現在画面の hint。
 * @returns LLM に渡す箇条書き形式の user context。
 */
export const formatUserContextForPrompt = ({
  userId,
  access,
  currentPage,
}: {
  userId: string;
  access: OrganizationStoreAccess;
  currentPage?: string | null;
}): string =>
  [
    `- userId: ${userId}`,
    `- organizationId: ${access.organizationId}`,
    `- storeId: ${access.storeId}`,
    `- role: ${access.display.primaryRole ?? 'authenticated'}`,
    `- currentPageHint: ${currentPage ?? 'none'}`,
    `- canManageBookings: ${access.effective.canManageBookings}`,
    `- canManageParticipants: ${access.effective.canManageParticipants}`,
    `- canUseParticipantBooking: ${access.effective.canUseParticipantBooking}`,
  ].join('\n');

/**
 * 検索済みナレッジ chunk を、許可済み範囲だけ prompt 用に整形する。
 *
 * @param contexts - source visibility policy 適用後の検索結果。
 * @returns 根拠文書の title、source、本文を含む prompt block。空の場合は明示的な none 表現。
 */
export const formatRetrievedDocsForPrompt = (contexts: RetrievedKnowledgeContext[]): string => {
  if (contexts.length === 0) {
    return '- permitted sources: none';
  }

  return contexts
    .map((context, index) =>
      [
        `[${index + 1}] ${context.title}`,
        `sourceKind: ${context.sourceKind}`,
        `sourcePath: ${context.sourcePath ?? 'hidden'}`,
        `content: ${redactSensitiveText(context.content)}`,
      ].join('\n'),
    )
    .join('\n\n');
};

/**
 * 回答時点で DB から読める業務 facts を prompt 用に整形する。
 *
 * @param facts - 認可済み文脈で収集した業務 facts。
 * @returns facts の箇条書き。fact がない場合は明示的な none 表現。
 */
export const formatBusinessFactsForPrompt = (facts: BusinessFactSummary | null): string => {
  if (!facts || facts.lines.length === 0) {
    return '- current permitted facts: none';
  }

  return facts.lines.map((line) => `- ${redactSensitiveText(line)}`).join('\n');
};

/**
 * 認可済みの事実だけから最終ユーザープロンプトを構築する。
 *
 * この関数を呼ぶ前に、ルートレベルのアクセスフィルタで許可されない文書と DB 由来の事実は
 * 取り除かれている必要がある。
 */
export const buildAnswerPrompt = ({
  userId,
  access,
  currentPage,
  retrievedContexts,
  businessFacts,
  message,
}: {
  userId: string;
  access: OrganizationStoreAccess;
  currentPage?: string | null;
  retrievedContexts: RetrievedKnowledgeContext[];
  businessFacts: BusinessFactSummary | null;
  message: string;
}): string =>
  [
    'User context:',
    formatUserContextForPrompt({ userId, access, currentPage }),
    '',
    'Retrieved docs:',
    formatRetrievedDocsForPrompt(retrievedContexts),
    '',
    'DB facts:',
    formatBusinessFactsForPrompt(businessFacts),
    '',
    'User question:',
    redactSensitiveText(message),
    '',
    'Return JSON with keys: answer, confidence, needsHumanSupport, suggestedActions.',
  ].join('\n');

/**
 * AI Gateway cache を使わないべき質問かを判定する。
 *
 * 請求、支払い、個人情報、sensitive facts はユーザーや時点ごとに変わるため cache を避ける。
 *
 * @param message - ユーザーの質問文。
 * @param facts - 回答生成に使う業務 facts。
 * @returns cache を bypass するべき場合は true。
 */
export const shouldSkipAiGatewayCache = (
  message: string,
  facts: BusinessFactSummary | null,
): boolean => {
  // 請求や個人情報に関するプロンプトは変動しやすい機微コンテキストを含み得るため、
  // モデル呼び出し自体がキャッシュ可能でも AI Gateway キャッシュを避ける。
  if (facts?.sensitive) {
    return true;
  }

  return /請求|領収|支払|カード|invoice|receipt|payment|billing|個人情報|メールアドレス/u.test(
    message,
  );
};

/** Reserve App の認可済み facts とナレッジだけから prompt を組み立てる builder。 */
export const reserveAppPromptBuilder: PromptBuilder<OrganizationStoreAccess> = {
  build({ userId, context: access, currentPage, retrievedContexts, businessFacts, message }) {
    const skipCache = shouldSkipAiGatewayCache(message, businessFacts);
    return {
      systemPrompt: buildAiSystemPrompt(),
      userPrompt: buildAnswerPrompt({
        userId,
        access,
        currentPage,
        retrievedContexts,
        businessFacts,
        message,
      }),
      skipCache,
      cacheTtl: skipCache ? undefined : 60,
      metadata: {
        organizationId: access.organizationId,
        storeId: access.storeId,
      },
    };
  },
};
