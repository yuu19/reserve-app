import type { BillingProviderCode } from './types.js';

/** provider webhook event の claim 結果。 */
export type ProviderEventClaimResult =
  /** 初回受領としてこの worker が処理権を取得した。 */
  | { kind: 'claimed'; attempt: number }
  /** 既に処理済みの duplicate event。 */
  | { kind: 'already_processed' }
  /** 別 worker が fresh な処理中のため、今回は処理しない。 */
  | { kind: 'already_processing_fresh' }
  /** stale processing または failed event を再 claim した。 */
  | { kind: 'already_processing_stale_claimed'; attempt: number };

/** provider webhook event の冪等処理を永続化する store port。 */
export interface BillingEventStore {
  /**
   * provider event を処理対象として claim する。
   *
   * @param input.provider event の発行 provider。
   * @param input.providerEventId provider が保証する event ID。
   * @param input.eventType webhook event type。
   * @param input.payloadHash 受領 payload の同一性確認用 hash。
   * @param input.now 受領・stale 判定に使う基準時刻。
   * @param input.staleProcessingAfterMs processing 状態を stale と扱うまでの猶予。
   * @returns 初回 claim、処理済み duplicate、fresh processing、または stale 再 claim の結果。
   */
  claimProviderEvent(input: {
    provider: BillingProviderCode;
    providerEventId: string;
    eventType: string;
    payloadHash: string;
    now: Date;
    staleProcessingAfterMs: number;
  }): Promise<ProviderEventClaimResult>;

  /** claim 済み provider event を処理済みとして確定する。 */
  markProviderEventProcessed(input: {
    provider: BillingProviderCode;
    providerEventId: string;
    processedAt: Date;
  }): Promise<void>;

  /** claim 済み provider event の失敗理由を残し、後続 retry が再 claim できる状態にする。 */
  markProviderEventFailed(input: {
    provider: BillingProviderCode;
    providerEventId: string;
    failedAt: Date;
    errorMessage: string;
  }): Promise<void>;
}
