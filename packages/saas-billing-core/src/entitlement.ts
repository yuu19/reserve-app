import type { BillingEntitlement, BillingEntitlementInput } from './ports.js';

/**
 * 指定した entitlement key が現在有効かを判定する。
 *
 * @param input.entitlements 対象 billing account に紐づく entitlement 一覧。
 * @param input.key 判定したい機能 entitlement の key。
 * @param input.now 有効期間の境界判定に使う時刻。未指定時は現在時刻。
 * @returns active で、かつ `validFrom <= now < validUntil` を満たす entitlement があれば `true`。
 */
export const hasActiveBillingEntitlement = ({
  entitlements,
  key,
  now = new Date(),
}: {
  entitlements: BillingEntitlement[];
  key: string;
  now?: Date;
}): boolean =>
  entitlements.some(
    (entitlement) =>
      entitlement.key === key &&
      entitlement.active &&
      (!entitlement.validFrom || entitlement.validFrom.getTime() <= now.getTime()) &&
      (!entitlement.validUntil || entitlement.validUntil.getTime() > now.getTime()),
  );

/**
 * trial や paid plan から付与する有効な entitlement 入力を作る。
 *
 * @param input.key 機能 entitlement の key。
 * @param input.source entitlement の付与元。
 * @param input.reason 管理画面や監査ログで読める付与理由。
 * @param input.validFrom entitlement の有効開始時刻。未指定時は即時有効扱い。
 * @param input.validUntil entitlement の有効終了時刻。未指定時は期限なし。
 * @returns 永続化処理に渡せる active な entitlement 入力。
 */
export const createActiveEntitlementInput = ({
  key,
  source,
  reason,
  validFrom = null,
  validUntil = null,
}: Pick<BillingEntitlementInput, 'key' | 'source' | 'reason'> & {
  validFrom?: Date | null;
  validUntil?: Date | null;
}): BillingEntitlementInput => ({
  key,
  active: true,
  source,
  reason,
  validFrom,
  validUntil,
});
