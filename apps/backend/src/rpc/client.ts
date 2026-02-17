import { hc } from 'hono/client';
import type { AppType } from '../app.js';

type RpcClientOptions = {
  credentials?: RequestCredentials;
  fetch?: typeof globalThis.fetch;
};

export const createRpcClient = (baseUrl: string, options: RpcClientOptions = {}) => {
  return hc<AppType>(baseUrl, {
    fetch: options.fetch,
    init: {
      credentials: options.credentials ?? 'include',
    },
  });
};
