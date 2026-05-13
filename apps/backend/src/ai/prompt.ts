import type { OrganizationClassroomAccess } from '../booking/authorization.js';
import type { AiSourceReference } from './source-visibility.js';

export type RetrievedKnowledgeContext = AiSourceReference & {
  content: string;
  score?: number;
};

export type BusinessFactSummary = {
  factKeys: string[];
  lines: string[];
  sensitive: boolean;
};

export const redactSensitiveText = (value: string): string =>
  value
    .replace(/sk_(live|test)_[A-Za-z0-9_]+/g, '[redacted-secret]')
    .replace(
      /(invoice|receipt|payment|card|stripe)[^\n]{0,80}(https?:\/\/\S+)/giu,
      '$1 [redacted-url]',
    )
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[redacted-card-number]');

export const buildAiSystemPrompt = (): string =>
  [
    'あなたは reserve-app のAIサポートです。',
    '回答は日本語を既定にし、根拠がある内容だけを案内してください。',
    '予約作成、課金変更、参加者変更、チケット付与、招待送信などの操作は実行せず、利用者が開ける画面や確認手順だけを案内してください。',
    'ユーザーの権限外の情報、内部仕様、請求書、領収書、支払い方法、秘密情報、外部サービスの生ペイロード、私的な監査情報は出してはいけません。',
    '根拠がない、根拠が矛盾する、または権限が不足する場合は断定せず、ownerまたはsupportへ確認する導線を示してください。',
    '回答は簡潔にし、既存の予約、参加者、招待、チケット、課金、権限の用語を使ってください。',
  ].join('\n');

export const formatUserContextForPrompt = ({
  userId,
  access,
  currentPage,
}: {
  userId: string;
  access: OrganizationClassroomAccess;
  currentPage?: string | null;
}): string =>
  [
    `- userId: ${userId}`,
    `- organizationId: ${access.organizationId}`,
    `- classroomId: ${access.classroomId}`,
    `- role: ${access.display.primaryRole ?? 'authenticated'}`,
    `- currentPageHint: ${currentPage ?? 'none'}`,
    `- canManageBookings: ${access.effective.canManageBookings}`,
    `- canManageParticipants: ${access.effective.canManageParticipants}`,
    `- canUseParticipantBooking: ${access.effective.canUseParticipantBooking}`,
  ].join('\n');

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

export const formatBusinessFactsForPrompt = (facts: BusinessFactSummary | null): string => {
  if (!facts || facts.lines.length === 0) {
    return '- current permitted facts: none';
  }

  return facts.lines.map((line) => `- ${redactSensitiveText(line)}`).join('\n');
};

export const buildAnswerPrompt = ({
  userId,
  access,
  currentPage,
  retrievedContexts,
  businessFacts,
  message,
}: {
  userId: string;
  access: OrganizationClassroomAccess;
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

export const shouldSkipAiGatewayCache = (
  message: string,
  facts: BusinessFactSummary | null,
): boolean => {
  if (facts?.sensitive) {
    return true;
  }

  return /請求|領収|支払|カード|invoice|receipt|payment|billing|個人情報|メールアドレス/u.test(
    message,
  );
};
