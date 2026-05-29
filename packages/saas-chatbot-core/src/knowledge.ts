import type { AiLocale, AiSourceKind, AiSourceVisibility } from './types.js';
import type { AiSourceReference } from './ui-contract.js';

/** 回答生成時に backend が注入する最新の業務情報。 */
export type BusinessFactSummary = {
  /** 回答生成に使った業務情報の識別子。 */
  factKeys: string[];
  /** prompt に差し込める短い業務情報の行。 */
  lines: string[];
  /** 機微情報を含むため参照元表示やログで注意が必要な場合は `true`。 */
  sensitive: boolean;
};

/** 実行時の文脈から回答時点の業務情報を取得する境界。 */
export interface BusinessFactsProvider<TContext = unknown> {
  /** 文脈に基づき、回答生成へ渡す業務情報を返す。 */
  getFacts(context: TContext): Promise<BusinessFactSummary>;
}

/** ナレッジ検索結果として prompt と参照元表示へ渡す文脈。 */
export type RetrievedKnowledgeContext = AiSourceReference & {
  /** prompt に渡す chunk 本文。 */
  content: string;
  /** 検索処理が返した関連度 score。 */
  score?: number;
};

/** index から取得した knowledge chunk の正規化済み表現。 */
export type RetrievedKnowledgeChunk = RetrievedKnowledgeContext & {
  /** chunk の内部 ID。 */
  id: string;
  /** ナレッジ検索の関連度 score。 */
  score: number;
  /** chunk 本文の hash。再 index 判定や監査に使う。 */
  contentHash: string;
  /** この chunk を読める最小公開範囲。 */
  visibility: AiSourceVisibility;
};

/** ナレッジ検索の入力。 */
export type RetrieveKnowledgeInput<TContext = unknown> = {
  /** 利用者の質問本文。 */
  message: string;
  /** 公開範囲や scope 絞り込みに使う実行時の文脈。 */
  context: TContext;
  /** 呼び出し側で許可済みの参照元公開範囲。 */
  allowedVisibilities: AiSourceVisibility[];
  /** 内部向け knowledge を利用できる operator かどうか。 */
  internalOperator: boolean;
  /** locale を明示したい場合の言語コード。 */
  locale?: string;
};

/** Vectorize などから権限に応じた knowledge chunk を取得する境界。 */
export interface KnowledgeRetriever<
  TContext = unknown,
  TChunk extends RetrievedKnowledgeContext = RetrievedKnowledgeChunk,
> {
  /** 入力文脈と公開範囲に合う knowledge chunk を返す。 */
  retrieveKnowledge(input: RetrieveKnowledgeInput<TContext>): Promise<TChunk[]>;
}

/** index 可能な knowledge document の参照元メタデータと本文。 */
export type KnowledgeSource = {
  /** document の由来分類。 */
  sourceKind: AiSourceKind;
  /** 参照元を再取得または表示するための path。 */
  sourcePath: string;
  /** 参照元表示に使う title。 */
  title: string;
  /** index 対象の document 本文。 */
  content: string;
  /** document の主 locale。 */
  locale?: AiLocale;
  /** document を読める最小公開範囲。 */
  visibility?: AiSourceVisibility;
  /** 内部 operator 以外へ出さない参照元の場合は `true`。 */
  internalOnly?: boolean;
  /** organization 固有参照元の organization ID。 */
  organizationId?: string | null;
  /** store 固有参照元の store ID。 */
  storeId?: string | null;
  /** 機能単位で参照元を絞るための feature key。 */
  feature?: string | null;
  /** 参照元の検索・運用分類に使う tag。 */
  tags?: string[];
};

/** indexer が受け取る document 型の互換 alias。 */
export type IndexableKnowledgeDocument = KnowledgeSource;

/** Vectorize などの検索 index に保存する chunk。 */
export type KnowledgeChunk = {
  /** chunk の内部 ID。 */
  id: string;
  /** chunk が属する document ID。 */
  documentId: string;
  /** document 内の chunk 順序。 */
  chunkIndex: number;
  /** chunk 本文。 */
  content: string;
  /** chunk 本文の hash。 */
  contentHash: string;
  /** 参照元表示に使う title。 */
  title: string;
  /** document の由来分類。 */
  sourceKind: AiSourceKind;
  /** 参照元を再取得または表示するための path。 */
  sourcePath: string;
  /** chunk の locale。 */
  locale: AiLocale;
  /** chunk を読める最小公開範囲。 */
  visibility: AiSourceVisibility;
  /** 内部 operator 以外へ出さない chunk の場合は `true`。 */
  internalOnly: boolean;
  /** organization 固有 chunk の organization ID。 */
  organizationId?: string | null;
  /** store 固有 chunk の store ID。 */
  storeId?: string | null;
  /** 機能単位で chunk を絞るための feature key。 */
  feature?: string | null;
  /** chunk の検索・運用分類に使う tag。 */
  tags?: string[];
};

/** knowledge document を indexer に upsert する入力。 */
export type UpsertKnowledgeDocumentInput<TDocument extends KnowledgeSource = KnowledgeSource> = {
  /** upsert 対象の document。 */
  document: TDocument;
  /** index 更新時刻。未指定時は実装側の現在時刻を使う。 */
  now?: Date;
};

/** knowledge document の upsert 結果。 */
export type KnowledgeIndexResult = {
  /** upsert された document ID。 */
  documentId: string;
  /** 作成または更新された chunk 数。 */
  chunksUpserted: number;
};

/** knowledge document を chunk 化して検索 index へ反映する境界。 */
export interface KnowledgeIndexer<TDocument extends KnowledgeSource = KnowledgeSource> {
  /** document を upsert し、検索可能な chunk に反映する。 */
  upsertKnowledgeDocument(
    input: UpsertKnowledgeDocumentInput<TDocument>,
  ): Promise<KnowledgeIndexResult>;
}
