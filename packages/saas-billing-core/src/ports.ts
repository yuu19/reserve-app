import type {
  BillingEntitlementSource,
  BillingInterval,
  BillingPaymentIssueStartedAtSource,
  BillingPaymentIssueState,
  BillingPortalFlow,
  BillingProviderCode,
  BillingSubjectType,
  BillingSubscriptionStatus,
} from './types.js';

/** 決済プロバイダー側に作成された customer の最小表現。 */
export type ProviderCustomer = {
  /** 決済プロバイダー API で customer を参照する ID。 */
  id: string;
};

/** 決済プロバイダー側 subscription を SaaS 側の状態更新へ使う最小表現。 */
export type ProviderSubscription = {
  /** 決済プロバイダー API で subscription を参照する ID。 */
  id: string;
  /** subscription が紐づく決済プロバイダー側 customer ID。 */
  customerId: string | null;
  /** 決済プロバイダー固有の subscription status。永続化前に正規化する。 */
  status: string | null;
  /** 現在期間末でキャンセル予定かどうか。 */
  cancelAtPeriodEnd: boolean;
  /** 決済プロバイダーが示す現在請求期間の開始時刻。 */
  currentPeriodStart: Date | null;
  /** 決済プロバイダーが示す現在請求期間の終了時刻。 */
  currentPeriodEnd: Date | null;
  /** subscription item の決済プロバイダー側 price ID。 */
  priceId: string | null;
};

/** 決済プロバイダーが作成した Checkout Session の遷移情報。 */
export type ProviderCheckoutSession = {
  /** 決済プロバイダー側 Checkout Session ID。 */
  id: string;
  /** 利用者を遷移させる Checkout URL。 */
  url: string;
  /** 決済プロバイダーが返す payment status。確認できない場合は省略される。 */
  paymentStatus?: string;
  /** 決済プロバイダーが返す session status。確認できない場合は省略される。 */
  status?: string;
};

/** 決済プロバイダーが作成した Customer Portal Session の遷移情報。 */
export type ProviderPortalSession = {
  /** 決済プロバイダー側 Portal Session ID。返されない場合は `null`。 */
  id: string | null;
  /** 利用者を遷移させる Customer Portal URL。 */
  url: string;
};

/** 課金画面で支払い方法の登録状態を確認するための customer 要約。 */
export type ProviderCustomerSummary = {
  /** 決済プロバイダー側 customer ID。 */
  id: string;
  /** 既定支払い方法の決済プロバイダー側 ID。未登録なら `null`。 */
  defaultPaymentMethodId: string | null;
};

/** Stripe などの決済プロバイダー API を課金ユースケースから分離する境界。 */
export interface BillingProvider {
  /** 課金対象に対応する決済プロバイダー側 customer を冪等に作成する。 */
  createCustomer(input: {
    email?: string | null;
    name?: string | null;
    metadata?: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderCustomer>;

  /** trial 付き subscription を決済プロバイダー側に冪等に作成する。 */
  createTrialSubscription(input: {
    customerId: string;
    priceId: string;
    trialDays: number;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderSubscription>;

  /** 有料 plan 購入用の Checkout Session を冪等に作成する。 */
  createSubscriptionCheckoutSession(input: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderCheckoutSession>;

  /** 支払い方法登録用の Checkout Session を冪等に作成する。 */
  createSetupCheckoutSession(input: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderCheckoutSession>;

  /** 請求情報変更や subscription 更新用の Customer Portal Session を冪等に作成する。 */
  createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
    flow: BillingPortalFlow;
    idempotencyKey: string;
  }): Promise<ProviderPortalSession>;

  /** 決済プロバイダー側 subscription ID から最新状態を取得する。 */
  retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription | null>;

  /** 決済プロバイダー側 customer ID から支払い方法登録状態を含む要約を取得する。 */
  retrieveCustomerSummary(customerId: string): Promise<ProviderCustomerSummary | null>;
}

/** SaaS plan と決済プロバイダー側 price の公開対応情報。 */
export type BillingPlanPrice = {
  /** SaaS 側で選択・表示に使う plan code。 */
  planCode: string;
  /** plan price の請求間隔。 */
  interval: BillingInterval;
  /** 決済プロバイダー API に渡す price ID。 */
  providerPriceId: string;
};

/** 課金対象ごとの課金ルート。決済プロバイダー側 customer と請求先情報を保持する。 */
export type BillingAccount = {
  /** billing account の内部 ID。 */
  id: string;
  /** 課金対象の種別。 */
  subjectType: BillingSubjectType;
  /** 課金対象の ID。 */
  subjectId: string;
  /** この account が利用する決済プロバイダー。 */
  provider: BillingProviderCode;
  /** 決済プロバイダー側 customer ID。未作成時は `null`。 */
  providerCustomerId: string | null;
  /** 請求連絡先メールアドレス。未設定時は `null`。 */
  billingEmail: string | null;
  /** 請求名義。未設定時は `null`。 */
  billingName: string | null;
  /** billing account 作成時刻。 */
  createdAt: Date;
  /** billing account 最終更新時刻。 */
  updatedAt: Date;
};

/** billing account に紐づく現在または最新の subscription 状態。 */
export type BillingSubscription = {
  /** subscription の内部 ID。 */
  id: string;
  /** 紐づく billing account ID。 */
  billingAccountId: string;
  /** subscription を管理する決済プロバイダー。 */
  provider: BillingProviderCode;
  /** 決済プロバイダー側 subscription ID。trial/free など未作成時は `null`。 */
  providerSubscriptionId: string | null;
  /** 決済プロバイダー側 schedule ID。利用しない場合は `null`。 */
  providerScheduleId: string | null;
  /** SaaS 側の plan code。 */
  planCode: string;
  /** SaaS 側の price code。未設定時は `null`。 */
  priceCode: string | null;
  /** 請求間隔。free など interval を持たない状態では `null`。 */
  interval: BillingInterval | null;
  /** entitlement と支払い制御に使う正規化済み状態。 */
  status: BillingSubscriptionStatus;
  /** 決済プロバイダーが示す現在請求期間の開始時刻。 */
  currentPeriodStart: Date | null;
  /** 決済プロバイダーが示す現在請求期間の終了時刻。 */
  currentPeriodEnd: Date | null;
  /** trial 開始時刻。trial でない場合は `null`。 */
  trialStart: Date | null;
  /** trial 終了時刻。trial でない場合は `null`。 */
  trialEnd: Date | null;
  /** 決済プロバイダー側のキャンセル予定時刻。未設定時は `null`。 */
  cancelAt: Date | null;
  /** 現在期間末でキャンセル予定かどうか。 */
  cancelAtPeriodEnd: boolean;
  /** subscription 作成時刻。 */
  createdAt: Date;
  /** subscription 最終更新時刻。 */
  updatedAt: Date;
};

/** billing account に付与された機能利用権。 */
export type BillingEntitlement = {
  /** entitlement row の内部 ID。 */
  id: string;
  /** 紐づく billing account ID。 */
  billingAccountId: string;
  /** 機能利用可否を判定する key。 */
  key: string;
  /** 現在有効な付与かどうか。 */
  active: boolean;
  /** 付与元の課金状態または運用操作。 */
  source: BillingEntitlementSource;
  /** 付与理由。監査や管理画面で説明に使う。 */
  reason: string;
  /** 有効開始時刻。`null` の場合は開始制限なし。 */
  validFrom: Date | null;
  /** 有効終了時刻。`null` の場合は期限なし。 */
  validUntil: Date | null;
  /** entitlement 作成時刻。 */
  createdAt: Date;
  /** entitlement 最終更新時刻。 */
  updatedAt: Date;
};

/** 現在の支払い問題を billing account 単位で要約した状態。 */
export type BillingPaymentIssue = {
  /** 支払い問題 row の内部 ID。 */
  id: string;
  /** 紐づく billing account ID。 */
  billingAccountId: string;
  /** 関連 subscription ID。特定できない決済プロバイダーイベントでは `null`。 */
  billingSubscriptionId: string | null;
  /** オーナー表示用に正規化された支払い問題状態。 */
  state: BillingPaymentIssueState;
  /** 支払い問題が始まったと扱う時刻。 */
  issueStartedAt: Date | null;
  /** `issueStartedAt` の根拠。 */
  issueStartedAtSource: BillingPaymentIssueStartedAtSource;
  /** past_due 猶予の終了時刻。猶予がなければ `null`。 */
  pastDueGraceEndsAt: Date | null;
  /** 状態更新の根拠になった最新の決済プロバイダーイベント ID。 */
  latestProviderEventId: string | null;
  /** 状態更新の根拠になった最新 invoice ID。 */
  latestInvoiceId: string | null;
  /** 状態更新の根拠になった最新 payment intent ID。 */
  latestPaymentIntentId: string | null;
  /** 支払い問題 row の作成時刻。 */
  createdAt: Date;
  /** 支払い問題 row の最終更新時刻。 */
  updatedAt: Date;
};

/** subscription の作成・更新で永続化処理に渡す正規化済み入力。 */
export type BillingSubscriptionUpsert = {
  /** 更新対象の billing account ID。 */
  billingAccountId: string;
  /** subscription を管理する決済プロバイダー。 */
  provider: BillingProviderCode;
  /** 決済プロバイダー側 subscription ID。まだ確定していない場合は省略可能。 */
  providerSubscriptionId?: string | null;
  /** 決済プロバイダー側 schedule ID。利用しない場合は省略可能。 */
  providerScheduleId?: string | null;
  /** SaaS 側の plan code。 */
  planCode: string;
  /** SaaS 側の price code。 */
  priceCode?: string | null;
  /** plan の請求間隔。 */
  interval?: BillingInterval | null;
  /** SaaS 側に正規化済みの subscription 状態。 */
  status: BillingSubscriptionStatus;
  /** 現在請求期間の開始時刻。 */
  currentPeriodStart?: Date | null;
  /** 現在請求期間の終了時刻。 */
  currentPeriodEnd?: Date | null;
  /** trial 開始時刻。 */
  trialStart?: Date | null;
  /** trial 終了時刻。 */
  trialEnd?: Date | null;
  /** 決済プロバイダー側のキャンセル予定時刻。 */
  cancelAt?: Date | null;
  /** 現在期間末キャンセル予定かどうか。 */
  cancelAtPeriodEnd?: boolean;
};

/** entitlement を現在値へ置き換える際の入力。 */
export type BillingEntitlementInput = {
  /** 機能利用可否を判定する key。 */
  key: string;
  /** 有効な付与として扱うかどうか。 */
  active: boolean;
  /** 付与元の課金状態または運用操作。 */
  source: BillingEntitlementSource;
  /** 管理画面や監査ログで読める付与理由。 */
  reason: string;
  /** 有効開始時刻。省略時は開始制限なし。 */
  validFrom?: Date | null;
  /** 有効終了時刻。省略時は期限なし。 */
  validUntil?: Date | null;
};

/** 現在の支払い問題を作成または更新するための入力。 */
export type BillingPaymentIssueUpsert = {
  /** 更新対象の billing account ID。 */
  billingAccountId: string;
  /** 関連 subscription ID。特定できない場合は省略可能。 */
  billingSubscriptionId?: string | null;
  /** オーナー表示用に正規化済みの支払い問題状態。 */
  state: BillingPaymentIssueState;
  /** 支払い問題が始まったと扱う時刻。 */
  issueStartedAt?: Date | null;
  /** `issueStartedAt` の根拠。 */
  issueStartedAtSource: BillingPaymentIssueStartedAtSource;
  /** past_due 猶予の終了時刻。 */
  pastDueGraceEndsAt?: Date | null;
  /** 状態更新の根拠になった決済プロバイダーイベント ID。 */
  latestProviderEventId?: string | null;
  /** 状態更新の根拠になった invoice ID。 */
  latestInvoiceId?: string | null;
  /** 状態更新の根拠になった payment intent ID。 */
  latestPaymentIntentId?: string | null;
};

/** 支払い問題に関連する invoice/payment event の追記専用履歴入力。 */
export type BillingPaymentIssueEventInput = {
  /** 履歴を紐づける billing account ID。 */
  billingAccountId: string;
  /** 関連 subscription ID。特定できない場合は省略可能。 */
  billingSubscriptionId?: string | null;
  /** 決済プロバイダーイベントから正規化した支払いイベント種別。 */
  eventType: string;
  /** event を発行した決済プロバイダー。 */
  provider: BillingProviderCode;
  /** 決済プロバイダーイベント ID。合成イベントでは省略可能。 */
  providerEventId?: string | null;
  /** 決済プロバイダー側 invoice ID。 */
  providerInvoiceId?: string | null;
  /** 決済プロバイダー側 payment intent ID。 */
  providerPaymentIntentId?: string | null;
  /** 決済プロバイダーイベントが発生した時刻。未取得時は省略可能。 */
  occurredAt?: Date | null;
};

/** billing account、subscription、entitlement、支払い問題を永続化する境界。 */
export interface BillingStore {
  /** subject から billing account を検索する。 */
  findAccountBySubject(input: {
    subjectType: BillingSubjectType;
    subjectId: string;
  }): Promise<BillingAccount | null>;

  /** subject に対応する billing account を冪等に作成または取得する。 */
  ensureAccount(input: {
    subjectType: BillingSubjectType;
    subjectId: string;
    provider: BillingProviderCode;
    billingEmail?: string | null;
    billingName?: string | null;
  }): Promise<BillingAccount>;

  /** 決済プロバイダー側 customer 作成後に billing account と customer ID を紐づける。 */
  updateProviderCustomerId(input: {
    billingAccountId: string;
    providerCustomerId: string;
  }): Promise<void>;

  /** 決済プロバイダー側 customer ID から billing account を逆引きする。 */
  findAccountByProviderCustomer(input: {
    provider: BillingProviderCode;
    providerCustomerId: string;
  }): Promise<BillingAccount | null>;

  /** billing account の現在扱いの subscription を取得する。 */
  findCurrentSubscription(input: { billingAccountId: string }): Promise<BillingSubscription | null>;

  /** 決済プロバイダー側 subscription ID から subscription を逆引きする。 */
  findSubscriptionByProviderSubscription(input: {
    provider: BillingProviderCode;
    providerSubscriptionId: string;
  }): Promise<BillingSubscription | null>;

  /** 決済プロバイダーまたはアプリ操作から得た subscription 状態を作成・更新する。 */
  upsertSubscription(input: BillingSubscriptionUpsert): Promise<BillingSubscription>;

  /** billing account の entitlement 一覧を読む。 */
  readEntitlements(input: { billingAccountId: string }): Promise<BillingEntitlement[]>;

  /** billing account の entitlement を現在状態に置き換える。 */
  replaceEntitlements(input: {
    billingAccountId: string;
    entitlements: BillingEntitlementInput[];
  }): Promise<void>;

  /** billing account の現在の支払い問題を読む。 */
  readPaymentIssue(input: { billingAccountId: string }): Promise<BillingPaymentIssue | null>;

  /** billing account の現在の支払い問題を作成・更新する。 */
  upsertPaymentIssue(input: BillingPaymentIssueUpsert): Promise<void>;

  /** 支払い問題に関連する invoice/payment event を追記専用で記録する。 */
  appendPaymentIssueEvent(input: BillingPaymentIssueEventInput): Promise<void>;
}
