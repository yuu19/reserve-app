import type { AiSourceReference } from './ui-contract.js';
import type { AiSourceVisibility } from './types.js';

export type AiSourceScope = {
  visibility: string;
  internalOnly?: boolean | null;
  organizationId?: string | null;
  classroomId?: string | null;
  locale?: string | null;
};

export type AiGeneratedSourceReference = AiSourceReference & {
  internalOnly?: boolean | null;
};

export type CanReadSourceInput<TContext = unknown> = {
  source: AiSourceScope;
  context: TContext;
  allowedVisibilities?: AiSourceVisibility[];
  internalOperator?: boolean;
  locale?: string;
};

export type SanitizeSourceReferenceInput<TContext = unknown> = {
  source: AiGeneratedSourceReference;
  context: TContext;
  internalOperator?: boolean;
};

export interface SourceVisibilityPolicy<TContext = unknown> {
  resolveAllowedVisibilities(context: TContext): AiSourceVisibility[];
  canUseInternalKnowledge(input: { context: TContext; internalOperator?: boolean }): boolean;
  canReadSource(input: CanReadSourceInput<TContext>): boolean;
  sanitizeSourceReference(input: SanitizeSourceReferenceInput<TContext>): AiSourceReference | null;
}
