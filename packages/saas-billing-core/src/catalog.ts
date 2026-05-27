import type { BillingInterval, BillingProviderCode } from './types.js';

/** 課金カタログの組み立て時に呼び出し側へ返す検証失敗の分類。 */
export type CatalogValidationErrorCode =
  | 'billing_price_not_configured'
  | 'billing_plan_not_found'
  | 'billing_interval_not_supported'
  | 'billing_unknown_provider_price';

/** 管理画面や起動時検証で、どの価格設定が不足しているかを伝えるエラー情報。 */
export type CatalogValidationError = {
  /** 呼び出し側が表示文言や復旧手順を分岐するための安定した失敗コード。 */
  code: CatalogValidationErrorCode;
  /** 対象プランを特定できる場合のアプリ内 plan code。 */
  planCode?: string;
  /** 対象請求間隔を特定できる場合の interval。 */
  interval?: BillingInterval;
  /** 対象 provider を特定できる場合の provider code。 */
  provider?: BillingProviderCode;
  /** provider 側 price ID の逆引き失敗時に含める ID。 */
  providerPriceId?: string;
  /** 運用ログや管理画面で読める短い説明。 */
  message: string;
};

/** アプリ内 plan と provider 側 price ID を対応付ける公開カタログ行。 */
export type BillingCatalogPrice = {
  /** SaaS 側の entitlement や表示に使う plan code。 */
  planCode: string;
  /** 月額・年額など、同じ plan の請求間隔。 */
  interval: BillingInterval;
  /** この価格を作成する決済 provider。 */
  provider: BillingProviderCode;
  /** Checkout や subscription 作成に渡す provider 側 price ID。 */
  providerPriceId: string;
};

/** 課金開始や webhook の price 逆引きで共有する価格カタログ。 */
export type BillingCatalog = {
  /** 利用可能な plan/interval/provider price の一覧。 */
  prices: BillingCatalogPrice[];
};

/** カタログ構築を例外ではなく検証結果として扱うための戻り値。 */
export type CatalogBuildResult =
  | { ok: true; catalog: BillingCatalog }
  | { ok: false; errors: CatalogValidationError[] };

/**
 * plan code と請求間隔から課金カタログの価格行を探す。
 *
 * @param input.catalog 検索対象の課金カタログ。
 * @param input.planCode SaaS 側で選択された plan code。
 * @param input.interval SaaS 側で選択された請求間隔。
 * @returns 対応する価格行。未設定の場合は `null`。
 *
 * @example
 * ```ts
 * const price = findCatalogPrice({ catalog, planCode: 'premium', interval: 'month' });
 * ```
 */
export const findCatalogPrice = ({
  catalog,
  planCode,
  interval,
}: {
  catalog: BillingCatalog;
  planCode: string;
  interval: BillingInterval;
}): BillingCatalogPrice | null =>
  catalog.prices.find((price) => price.planCode === planCode && price.interval === interval) ??
  null;

/**
 * provider 側 price ID から SaaS 側の価格行を逆引きする。
 *
 * @param input.catalog 検索対象の課金カタログ。
 * @param input.provider webhook や provider API から得た provider code。
 * @param input.providerPriceId webhook や provider API から得た price ID。
 * @returns 対応する価格行。未知の price の場合は `null`。
 */
export const findCatalogPriceByProviderPriceId = ({
  catalog,
  provider,
  providerPriceId,
}: {
  catalog: BillingCatalog;
  provider: BillingProviderCode;
  providerPriceId: string;
}): BillingCatalogPrice | null =>
  catalog.prices.find(
    (price) => price.provider === provider && price.providerPriceId === providerPriceId,
  ) ?? null;
