import type { AiSourceReference } from './ui-contract.js';
import type { AiSourceVisibility } from './types.js';

/** source の visibility 判定に使う scope metadata。 */
export type AiSourceScope = {
  /** source が要求する visibility。 */
  visibility: string;
  /** 内部 operator 専用 source の場合は `true`。 */
  internalOnly?: boolean | null;
  /** organization 固有 source の organization ID。 */
  organizationId?: string | null;
  /** classroom 固有 source の classroom ID。 */
  classroomId?: string | null;
  /** source の locale。 */
  locale?: string | null;
};

/** 生成結果に含まれる source reference。sanitize 前は内部属性を持てる。 */
export type AiGeneratedSourceReference = AiSourceReference & {
  /** 内部 operator 以外へ表示しない source の場合は `true`。 */
  internalOnly?: boolean | null;
};

/** source を現在 context で読めるか判定する入力。 */
export type CanReadSourceInput<TContext = unknown> = {
  /** 判定対象 source の scope metadata。 */
  source: AiSourceScope;
  /** user/organization/classroom などの runtime context。 */
  context: TContext;
  /** 呼び出し側で許可済みの visibility 一覧。 */
  allowedVisibilities?: AiSourceVisibility[];
  /** 内部向け source を読める operator かどうか。 */
  internalOperator?: boolean;
  /** locale 一致を判定したい場合の locale。 */
  locale?: string;
};

/** 生成済み source reference を UI 表示用に sanitize する入力。 */
export type SanitizeSourceReferenceInput<TContext = unknown> = {
  /** sanitize 対象の source reference。 */
  source: AiGeneratedSourceReference;
  /** user/organization/classroom などの runtime context。 */
  context: TContext;
  /** 内部向け source を表示できる operator かどうか。 */
  internalOperator?: boolean;
};

/** role-safe source visibility と source reference sanitize を担う policy。 */
export interface SourceVisibilityPolicy<TContext = unknown> {
  /** context に応じて読める visibility 一覧を返す。 */
  resolveAllowedVisibilities(context: TContext): AiSourceVisibility[];
  /** internal knowledge を retrieval に含めてよいか判定する。 */
  canUseInternalKnowledge(input: { context: TContext; internalOperator?: boolean }): boolean;
  /** source scope を現在 context で読めるか判定する。 */
  canReadSource(input: CanReadSourceInput<TContext>): boolean;
  /** UI に返してよい source reference だけを残し、非表示なら `null` を返す。 */
  sanitizeSourceReference(input: SanitizeSourceReferenceInput<TContext>): AiSourceReference | null;
}
