/**
 * リクエストで明示された storeId が実データの所属店舗と異なるかを判定します。
 */
export const isRequestedStoreMismatch = (
  requestedStoreId: string | null | undefined,
  actualStoreId: string,
) => Boolean(requestedStoreId && requestedStoreId !== actualStoreId);
