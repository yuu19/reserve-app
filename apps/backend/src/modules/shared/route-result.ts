import type { Context } from 'hono';

export type JsonStatus = 200 | 201 | 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 503;

export type JsonRouteResult<TBody = unknown> = {
  status: JsonStatus;
  body: TBody;
};

export const jsonResult = <TBody>(
  body: TBody,
  status: JsonStatus = 200,
): JsonRouteResult<TBody> => ({
  status,
  body,
});

export const unauthorized = (): JsonRouteResult<{ message: 'Unauthorized' }> =>
  jsonResult({ message: 'Unauthorized' }, 401);

export const forbidden = (): JsonRouteResult<{ message: 'Forbidden' }> =>
  jsonResult({ message: 'Forbidden' }, 403);

export const notFound = (message: string): JsonRouteResult<{ message: string }> =>
  jsonResult({ message }, 404);

export const conflict = (message: string): JsonRouteResult<{ message: string }> =>
  jsonResult({ message }, 409);

export const validationError = (message: string): JsonRouteResult<{ message: string }> =>
  jsonResult({ message }, 422);

export const jsonRouteResult = (c: Context, result: JsonRouteResult) =>
  c.json(result.body, result.status);
