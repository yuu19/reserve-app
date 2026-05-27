import type {
  BillingInterval,
  BillingOperationPurpose,
  BillingProviderCode,
  BillingSubjectType,
} from './types.js';

/** 同じ provider handoff を再利用できる範囲を表す業務キー。 */
export type BillingOperationReuseKey =
  | `start_trial_subscription:${BillingSubjectType}:${string}:${string}`
  | `create_subscription_checkout:${BillingSubjectType}:${string}:${string}:${BillingInterval}`
  | `create_setup_checkout:${BillingSubjectType}:${string}`
  | `create_portal_session:${BillingSubjectType}:${string}:default`
  | `create_portal_session:${BillingSubjectType}:${string}:subscription_update:${string}`
  | `create_portal_session:${BillingSubjectType}:${string}:subscription_cancel:${string}`;

/** Checkout や Customer Portal へ利用者を渡すための provider handoff 情報。 */
export type BillingOperationHandoff = {
  /** handoff URL を発行した provider。 */
  provider: 'stripe';
  /** handoff を発行した課金操作の目的。 */
  purpose: BillingOperationPurpose;
  /** 利用者を遷移させる provider URL。 */
  url: string;
  /** handoff URL を再利用できる期限。 */
  expiresAt: Date;
  /** 監査や後続更新で参照する operation attempt ID。 */
  operationAttemptId: string;
  /** 既存の成功済み handoff を再利用した場合は `true`。 */
  reused: boolean;
};

/** 課金操作 attempt の処理状態。 */
export type BillingOperationAttemptState =
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'conflict';

/** provider handoff を発行する操作の冪等性と結果を記録する履歴行。 */
export type BillingOperationAttempt = {
  /** attempt を一意に識別する ID。 */
  id: string;
  /** subject-scoped root である billing account の ID。 */
  billingAccountId: string;
  /** Checkout、trial、portal などの操作目的。 */
  purpose: BillingOperationPurpose;
  /** 再利用判定と attempt 番号採番の単位。 */
  reuseKey: BillingOperationReuseKey;
  /** 同一 reuse key 内で増加する attempt 番号。 */
  attemptNumber: number;
  /** provider API へ渡す冪等性キー。 */
  idempotencyKey: string;
  /** attempt の現在状態。 */
  state: BillingOperationAttemptState;
  /** 成功時に利用者へ返す provider handoff URL。 */
  handoffUrl: string | null;
  /** handoff URL の再利用期限。 */
  handoffExpiresAt: Date | null;
  /** attempt が呼び出す provider。 */
  provider: BillingProviderCode;
  /** provider customer が確定した場合の ID。 */
  providerCustomerId: string | null;
  /** provider subscription が確定した場合の ID。 */
  providerSubscriptionId: string | null;
  /** Checkout Session を作成した場合の provider 側 ID。 */
  providerCheckoutSessionId: string | null;
  /** Customer Portal Session を作成した場合の provider 側 ID。 */
  providerPortalSessionId: string | null;
  /** 失敗・競合・期限切れ時に運用者へ示す理由。 */
  failureReason: string | null;
  /** attempt を開始した user ID。system 起点では `null`。 */
  createdByUserId: string | null;
  /** attempt の作成時刻。 */
  createdAt: Date;
  /** attempt の最終更新時刻。 */
  updatedAt: Date;
};

/** attempt claim 時に、新規取得・再利用・fresh processing を区別する結果。 */
export type ClaimBillingOperationAttemptResult =
  | { kind: 'claimed'; attempt: BillingOperationAttempt }
  | { kind: 'reused_succeeded'; attempt: BillingOperationAttempt }
  | { kind: 'already_processing_fresh'; attempt: BillingOperationAttempt };

/** provider handoff 操作の冪等性と再利用を永続化する store port。 */
export interface BillingOperationStore {
  /**
   * reuse key 単位で attempt を claim する。
   *
   * @param input.billingAccountId 課金操作の対象 billing account。
   * @param input.purpose 課金操作の目的。
   * @param input.reuseKey 再利用と attempt 採番の単位。
   * @param input.provider 呼び出す provider。
   * @param input.createdByUserId 操作を開始した user ID。system 起点では省略可能。
   * @param input.now stale 判定と作成時刻に使う基準時刻。
   * @returns 新規 claim、成功済み handoff の再利用、または fresh processing の既存 attempt。
   */
  claimAttempt(input: {
    billingAccountId: string;
    purpose: BillingOperationPurpose;
    reuseKey: BillingOperationReuseKey;
    provider: BillingProviderCode;
    createdByUserId?: string | null;
    now: Date;
  }): Promise<ClaimBillingOperationAttemptResult>;

  /** provider handoff が発行できた attempt を成功状態に更新する。 */
  markSucceeded(input: {
    attemptId: string;
    handoffUrl?: string | null;
    handoffExpiresAt?: Date | null;
    providerCustomerId?: string | null;
    providerSubscriptionId?: string | null;
    providerCheckoutSessionId?: string | null;
    providerPortalSessionId?: string | null;
  }): Promise<BillingOperationAttempt | null>;

  /** provider handoff 失敗や競合を呼び出し側が再試行判断できる状態として記録する。 */
  markFailed(input: {
    attemptId: string;
    state?: Extract<BillingOperationAttemptState, 'conflict' | 'expired' | 'failed'>;
    failureReason: string;
  }): Promise<BillingOperationAttempt | null>;

  /** billing account の最近の operation attempt を運用確認用に読む。 */
  readRecent(input: {
    billingAccountId: string;
    limit?: number;
  }): Promise<BillingOperationAttempt[]>;
}

/** fresh processing とみなす pending attempt の許容時間。 */
export const BILLING_OPERATION_PENDING_STALE_MS = 2 * 60 * 1000;

/**
 * provider API へ渡す課金操作の冪等性キーを組み立てる。
 *
 * @param input.reuseKey 業務上の再利用単位。
 * @param input.attemptNumber 同一 reuse key 内の attempt 番号。
 * @returns provider idempotency key として使う安定した文字列。
 */
export const buildBillingOperationIdempotencyKey = ({
  reuseKey,
  attemptNumber,
}: {
  reuseKey: BillingOperationReuseKey;
  attemptNumber: number;
}) => `billing:${reuseKey}:${attemptNumber}`;

/**
 * trial subscription 開始操作の reuse key を組み立てる。
 *
 * @param input.subjectType 課金対象の種別。
 * @param input.subjectId 課金対象の ID。
 * @param input.planCode trial を開始する plan code。
 * @returns 同一 subject と plan の trial 開始を再利用するための key。
 */
export const buildStartTrialSubscriptionReuseKey = ({
  subjectType,
  subjectId,
  planCode,
}: {
  subjectType: BillingSubjectType;
  subjectId: string;
  planCode: string;
}): BillingOperationReuseKey => `start_trial_subscription:${subjectType}:${subjectId}:${planCode}`;

/**
 * subscription checkout 作成操作の reuse key を組み立てる。
 *
 * @param input.subjectType 課金対象の種別。
 * @param input.subjectId 課金対象の ID。
 * @param input.planCode checkout で購入する plan code。
 * @param input.interval checkout で購入する請求間隔。
 * @returns 同一 subject、plan、interval の checkout を再利用するための key。
 */
export const buildSubscriptionCheckoutReuseKey = ({
  subjectType,
  subjectId,
  planCode,
  interval,
}: {
  subjectType: BillingSubjectType;
  subjectId: string;
  planCode: string;
  interval: BillingInterval;
}): BillingOperationReuseKey =>
  `create_subscription_checkout:${subjectType}:${subjectId}:${planCode}:${interval}`;

/**
 * 支払い方法登録 checkout 作成操作の reuse key を組み立てる。
 *
 * @param input.subjectType 課金対象の種別。
 * @param input.subjectId 課金対象の ID。
 * @returns 同一 subject の setup checkout を再利用するための key。
 */
export const buildSetupCheckoutReuseKey = ({
  subjectType,
  subjectId,
}: {
  subjectType: BillingSubjectType;
  subjectId: string;
}): BillingOperationReuseKey => `create_setup_checkout:${subjectType}:${subjectId}`;

/**
 * Customer Portal Session 作成操作の reuse key を組み立てる。
 *
 * @param input.subjectType 課金対象の種別。
 * @param input.subjectId 課金対象の ID。
 * @param input.flow provider portal の遷移先 flow。
 * @returns flow 種別と subscription ID を含めた portal session 再利用 key。
 *
 * @example
 * ```ts
 * const reuseKey = buildPortalSessionReuseKey({
 *   subjectType: 'organization',
 *   subjectId: organizationId,
 *   flow: { type: 'subscription_update', subscriptionId },
 * });
 * ```
 */
export const buildPortalSessionReuseKey = ({
  subjectType,
  subjectId,
  flow,
}: {
  subjectType: BillingSubjectType;
  subjectId: string;
  flow:
    | { type: 'default' }
    | { type: 'subscription_update'; subscriptionId: string }
    | { type: 'subscription_cancel'; subscriptionId: string };
}): BillingOperationReuseKey => {
  if (flow.type === 'subscription_update') {
    return `create_portal_session:${subjectType}:${subjectId}:subscription_update:${flow.subscriptionId}`;
  }
  if (flow.type === 'subscription_cancel') {
    return `create_portal_session:${subjectType}:${subjectId}:subscription_cancel:${flow.subscriptionId}`;
  }
  return `create_portal_session:${subjectType}:${subjectId}:default`;
};
