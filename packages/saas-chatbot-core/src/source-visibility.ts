import type { AiSourceReference } from './ui-contract.js';
import type { AiSourceVisibility } from './types.js';

/** 参照元の公開範囲判定に使う scope メタデータ。 */
export type AiSourceScope = {
  /** 参照元が要求する公開範囲。 */
  visibility: string;
  /** 内部 operator 専用の参照元の場合は `true`。 */
  internalOnly?: boolean | null;
  /** organization 固有参照元の organization ID。 */
  organizationId?: string | null;
  /** classroom 固有参照元の classroom ID。 */
  classroomId?: string | null;
  /** 参照元の locale。 */
  locale?: string | null;
};

/** 生成結果に含まれる参照元情報。UI 表示用に整形する前は内部属性を持てる。 */
export type AiGeneratedSourceReference = AiSourceReference & {
  /** 内部 operator 以外へ表示しない参照元の場合は `true`。 */
  internalOnly?: boolean | null;
};

/** 参照元を現在の文脈で読めるか判定する入力。 */
export type CanReadSourceInput<TContext = unknown> = {
  /** 判定対象参照元の scope メタデータ。 */
  source: AiSourceScope;
  /** user/organization/classroom などの実行時の文脈。 */
  context: TContext;
  /** 呼び出し側で許可済みの公開範囲一覧。 */
  allowedVisibilities?: AiSourceVisibility[];
  /** 内部向け参照元を読める operator かどうか。 */
  internalOperator?: boolean;
  /** locale 一致を判定したい場合の locale。 */
  locale?: string;
};

/** 生成済み参照元情報を UI 表示用に整形する入力。 */
export type SanitizeSourceReferenceInput<TContext = unknown> = {
  /** 整形対象の参照元情報。 */
  source: AiGeneratedSourceReference;
  /** user/organization/classroom などの実行時の文脈。 */
  context: TContext;
  /** 内部向け参照元を表示できる operator かどうか。 */
  internalOperator?: boolean;
};

/** 権限に応じた参照元公開範囲と参照元情報の整形を担う方針。 */
export interface SourceVisibilityPolicy<TContext = unknown> {
  /** 文脈に応じて読める公開範囲一覧を返す。 */
  resolveAllowedVisibilities(context: TContext): AiSourceVisibility[];
  /** 内部向けナレッジをナレッジ検索に含めてよいか判定する。 */
  canUseInternalKnowledge(input: { context: TContext; internalOperator?: boolean }): boolean;
  /** 参照元 scope を現在の文脈で読めるか判定する。 */
  canReadSource(input: CanReadSourceInput<TContext>): boolean;
  /** UI に返してよい参照元情報だけを残し、非表示なら `null` を返す。 */
  sanitizeSourceReference(input: SanitizeSourceReferenceInput<TContext>): AiSourceReference | null;
}
