import { hc } from 'hono/client';
import type { AppType } from '../app/create-app.js';

type RpcClientOptions = {
  credentials?: RequestCredentials;
  fetch?: typeof globalThis.fetch;
};

/** AppType の推論が必要なテストや内部呼び出し向けに、型付き Hono RPC client を作成する。 */
export const createRpcClient = (baseUrl: string, options: RpcClientOptions = {}) => {
  return hc<AppType>(baseUrl, {
    fetch: options.fetch,
    init: {
      credentials: options.credentials ?? 'include',
    },
  });
};
