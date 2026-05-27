import type { AiLocale, AiSourceKind, AiSourceVisibility } from './types.js';
import type { AiSourceReference } from './ui-contract.js';

/** 回答生成時に backend が注入する最新の業務 facts。 */
export type BusinessFactSummary = {
  /** 回答生成に使った fact の識別子。 */
  factKeys: string[];
  /** prompt に差し込める短い fact 行。 */
  lines: string[];
  /** 機微情報を含むため source 表示やログで注意が必要な場合は `true`。 */
  sensitive: boolean;
};

/** runtime context から回答時点の業務 facts を取得する port。 */
export interface BusinessFactsProvider<TContext = unknown> {
  /** context に基づき、回答生成へ渡す business facts を返す。 */
  getFacts(context: TContext): Promise<BusinessFactSummary>;
}

/** retrieval 結果として prompt と source 表示へ渡す context。 */
export type RetrievedKnowledgeContext = AiSourceReference & {
  /** prompt に渡す chunk 本文。 */
  content: string;
  /** retriever が返した関連度 score。 */
  score?: number;
};

/** index から取得した knowledge chunk の正規化済み表現。 */
export type RetrievedKnowledgeChunk = RetrievedKnowledgeContext & {
  /** chunk の内部 ID。 */
  id: string;
  /** retrieval の関連度 score。 */
  score: number;
  /** chunk 本文の hash。再 index 判定や監査に使う。 */
  contentHash: string;
  /** この chunk を読める最小 visibility。 */
  visibility: AiSourceVisibility;
};

/** knowledge retrieval の入力。 */
export type RetrieveKnowledgeInput<TContext = unknown> = {
  /** 利用者の質問本文。 */
  message: string;
  /** visibility や scope 絞り込みに使う runtime context。 */
  context: TContext;
  /** 呼び出し側で許可済みの source visibility。 */
  allowedVisibilities: AiSourceVisibility[];
  /** 内部向け knowledge を利用できる operator かどうか。 */
  internalOperator: boolean;
  /** locale を明示したい場合の言語コード。 */
  locale?: string;
};

/** Vectorize などから role-safe な knowledge chunk を取得する port。 */
export interface KnowledgeRetriever<
  TContext = unknown,
  TChunk extends RetrievedKnowledgeContext = RetrievedKnowledgeChunk,
> {
  /** 入力 context と visibility に合う knowledge chunk を返す。 */
  retrieveKnowledge(input: RetrieveKnowledgeInput<TContext>): Promise<TChunk[]>;
}

/** index 可能な knowledge document の source metadata と本文。 */
export type KnowledgeSource = {
  /** document の由来分類。 */
  sourceKind: AiSourceKind;
  /** source を再取得または表示するための path。 */
  sourcePath: string;
  /** source 表示に使う title。 */
  title: string;
  /** index 対象の document 本文。 */
  content: string;
  /** document の主 locale。 */
  locale?: AiLocale;
  /** document を読める最小 visibility。 */
  visibility?: AiSourceVisibility;
  /** 内部 operator 以外へ出さない source の場合は `true`。 */
  internalOnly?: boolean;
  /** organization 固有 source の organization ID。 */
  organizationId?: string | null;
  /** classroom 固有 source の classroom ID。 */
  classroomId?: string | null;
  /** 機能単位で source を絞るための feature key。 */
  feature?: string | null;
  /** source の検索・運用分類に使う tag。 */
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
  /** source 表示に使う title。 */
  title: string;
  /** document の由来分類。 */
  sourceKind: AiSourceKind;
  /** source を再取得または表示するための path。 */
  sourcePath: string;
  /** chunk の locale。 */
  locale: AiLocale;
  /** chunk を読める最小 visibility。 */
  visibility: AiSourceVisibility;
  /** 内部 operator 以外へ出さない chunk の場合は `true`。 */
  internalOnly: boolean;
  /** organization 固有 chunk の organization ID。 */
  organizationId?: string | null;
  /** classroom 固有 chunk の classroom ID。 */
  classroomId?: string | null;
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

/** knowledge document を chunk 化して検索 index へ反映する port。 */
export interface KnowledgeIndexer<TDocument extends KnowledgeSource = KnowledgeSource> {
  /** document を upsert し、検索可能な chunk に反映する。 */
  upsertKnowledgeDocument(
    input: UpsertKnowledgeDocumentInput<TDocument>,
  ): Promise<KnowledgeIndexResult>;
}
