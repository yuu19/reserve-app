import type { Context } from 'hono';

/**
 * usecase が Hono へ返せる JSON HTTP status を限定します。
 */
export type JsonStatus = 200 | 201 | 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503;

/**
 * usecase 層が Hono Context に依存せず JSON 応答を表現するための戻り値です。
 */
export type JsonRouteResult<TBody = unknown> = {
  status: JsonStatus;
  body: TBody;
};

/**
 * usecase 層の戻り値を status/body の組として作ります。
 */
export const jsonResult = <TBody>(
  body: TBody,
  status: JsonStatus = 200,
): JsonRouteResult<TBody> => ({
  status,
  body,
});

/**
 * 認証が必要な route で session identity が取得できない場合の共通応答です。
 */
export const unauthorized = (): JsonRouteResult<{ message: 'Unauthorized' }> =>
  jsonResult({ message: 'Unauthorized' }, 401);

/**
 * 認可境界で権限不足が確定した場合の共通応答です。
 */
export const forbidden = (): JsonRouteResult<{ message: 'Forbidden' }> =>
  jsonResult({ message: 'Forbidden' }, 403);

/**
 * ID 指定された業務データが見つからない場合の共通応答を作ります。
 */
export const notFound = (message: string): JsonRouteResult<{ message: string }> =>
  jsonResult({ message }, 404);

/**
 * 状態遷移や重複など、現在のデータ状態では処理できない場合の共通応答を作ります。
 */
export const conflict = (message: string): JsonRouteResult<{ message: string }> =>
  jsonResult({ message }, 409);

/**
 * zod 検証後に業務ルールで不正と判断した入力の共通応答を作ります。
 */
export const validationError = (message: string): JsonRouteResult<{ message: string }> =>
  jsonResult({ message }, 422);

/**
 * usecase 層の JsonRouteResult を Hono の JSON response に変換します。
 */
export const jsonRouteResult = (c: Context, result: JsonRouteResult) =>
  c.json(result.body, result.status);
