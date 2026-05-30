import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { expectOkJson } from './assertions';
import { backendUrl } from './env';

type PublicEventDetail = {
  remainingCount: number;
  capacity: number;
};

/**
 * 公開 event detail API の残席数と定員を検証する。
 *
 * 認証なしで読める public route を対象にし、予約作成や回数券購入の副作用後の残数確認に使う。
 *
 * @param input - 公開 event と期待値を指定する option。
 * @param input.request - backend API を呼び出す Playwright request context。
 * @param input.orgSlug - 公開 organization slug。
 * @param input.storeSlug - 公開 store slug。
 * @param input.slotId - 残席数を確認する slot id。
 * @param input.remainingCount - 期待する残席数。
 * @param input.capacity - 期待する定員。
 */
export const expectPublicEventCapacity = async ({
  request,
  orgSlug,
  storeSlug,
  slotId,
  remainingCount,
  capacity,
}: {
  request: APIRequestContext;
  orgSlug: string;
  storeSlug: string;
  slotId: string;
  remainingCount: number;
  capacity: number;
}) => {
  const response = await request.get(
    `${backendUrl}/api/v1/public/orgs/${encodeURIComponent(
      orgSlug,
    )}/stores/${encodeURIComponent(storeSlug)}/events/${encodeURIComponent(slotId)}`,
  );
  const payload = await expectOkJson<PublicEventDetail>(response, `read public event ${slotId}`);
  expect(payload).toMatchObject({ remainingCount, capacity });
};
