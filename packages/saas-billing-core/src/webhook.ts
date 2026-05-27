import type { BillingProviderCode } from './types.js';

/** 決済プロバイダー webhook event の処理権取得結果。 */
export type ProviderEventClaimResult =
  /** 初回受領としてこの worker が処理権を取得した。 */
  | { kind: 'claimed'; attempt: number }
  /** 既に処理済みの重複 event。 */
  | { kind: 'already_processed' }
  /** 別 worker が有効な処理中状態のため、今回は処理しない。 */
  | { kind: 'already_processing_fresh' }
  /** 古い処理中状態または失敗済み event の処理権を取り直した。 */
  | { kind: 'already_processing_stale_claimed'; attempt: number };

/** 決済プロバイダー webhook event の冪等処理を永続化する境界。 */
export interface BillingEventStore {
  /**
   * 決済プロバイダー event の処理権を取得する。
   *
   * @param input.provider event の発行元プロバイダー。
   * @param input.providerEventId 決済プロバイダーが保証する event ID。
   * @param input.eventType webhook event type。
   * @param input.payloadHash 受領 payload の同一性確認用 hash。
   * @param input.now 受領時刻と古い処理中状態の判定に使う基準時刻。
   * @param input.staleProcessingAfterMs 処理中状態を古いと扱うまでの猶予。
   * @returns 初回取得、処理済み重複、有効な処理中状態、または古い処理中状態の再取得結果。
   */
  claimProviderEvent(input: {
    provider: BillingProviderCode;
    providerEventId: string;
    eventType: string;
    payloadHash: string;
    now: Date;
    staleProcessingAfterMs: number;
  }): Promise<ProviderEventClaimResult>;

  /** 処理権取得済みの決済プロバイダー event を処理済みとして確定する。 */
  markProviderEventProcessed(input: {
    provider: BillingProviderCode;
    providerEventId: string;
    processedAt: Date;
  }): Promise<void>;

  /** 処理権取得済みの決済プロバイダー event に失敗理由を残し、後続 retry が処理権を取り直せる状態にする。 */
  markProviderEventFailed(input: {
    provider: BillingProviderCode;
    providerEventId: string;
    failedAt: Date;
    errorMessage: string;
  }): Promise<void>;
}
