import type { BillingProviderCode } from './types.js';

export type ProviderEventClaimResult =
  | { kind: 'claimed'; attempt: number }
  | { kind: 'already_processed' }
  | { kind: 'already_processing_fresh' }
  | { kind: 'already_processing_stale_claimed'; attempt: number };

export interface BillingEventStore {
  claimProviderEvent(input: {
    provider: BillingProviderCode;
    providerEventId: string;
    eventType: string;
    payloadHash: string;
    now: Date;
    staleProcessingAfterMs: number;
  }): Promise<ProviderEventClaimResult>;

  markProviderEventProcessed(input: {
    provider: BillingProviderCode;
    providerEventId: string;
    processedAt: Date;
  }): Promise<void>;

  markProviderEventFailed(input: {
    provider: BillingProviderCode;
    providerEventId: string;
    failedAt: Date;
    errorMessage: string;
  }): Promise<void>;
}
