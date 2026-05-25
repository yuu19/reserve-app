import type { AiLocale, AiSourceKind, AiSourceVisibility } from './types.js';
import type { AiSourceReference } from './ui-contract.js';

export type BusinessFactSummary = {
  factKeys: string[];
  lines: string[];
  sensitive: boolean;
};

export interface BusinessFactsProvider<TContext = unknown> {
  getFacts(context: TContext): Promise<BusinessFactSummary>;
}

export type RetrievedKnowledgeContext = AiSourceReference & {
  content: string;
  score?: number;
};

export type RetrievedKnowledgeChunk = RetrievedKnowledgeContext & {
  id: string;
  score: number;
  contentHash: string;
  visibility: AiSourceVisibility;
};

export type RetrieveKnowledgeInput<TContext = unknown> = {
  message: string;
  context: TContext;
  allowedVisibilities: AiSourceVisibility[];
  internalOperator: boolean;
  locale?: string;
};

export interface KnowledgeRetriever<
  TContext = unknown,
  TChunk extends RetrievedKnowledgeContext = RetrievedKnowledgeChunk,
> {
  retrieveKnowledge(input: RetrieveKnowledgeInput<TContext>): Promise<TChunk[]>;
}

export type KnowledgeSource = {
  sourceKind: AiSourceKind;
  sourcePath: string;
  title: string;
  content: string;
  locale?: AiLocale;
  visibility?: AiSourceVisibility;
  internalOnly?: boolean;
  organizationId?: string | null;
  classroomId?: string | null;
  feature?: string | null;
  tags?: string[];
};

export type IndexableKnowledgeDocument = KnowledgeSource;

export type KnowledgeChunk = {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  title: string;
  sourceKind: AiSourceKind;
  sourcePath: string;
  locale: AiLocale;
  visibility: AiSourceVisibility;
  internalOnly: boolean;
  organizationId?: string | null;
  classroomId?: string | null;
  feature?: string | null;
  tags?: string[];
};

export type UpsertKnowledgeDocumentInput<TDocument extends KnowledgeSource = KnowledgeSource> = {
  document: TDocument;
  now?: Date;
};

export type KnowledgeIndexResult = {
  documentId: string;
  chunksUpserted: number;
};

export interface KnowledgeIndexer<TDocument extends KnowledgeSource = KnowledgeSource> {
  upsertKnowledgeDocument(
    input: UpsertKnowledgeDocumentInput<TDocument>,
  ): Promise<KnowledgeIndexResult>;
}
