import { drizzle } from 'drizzle-orm/d1';
import { createAuthRuntime, type AuthRuntimeEnv } from './auth-runtime.js';

type D1DatabaseBinding = Parameters<typeof drizzle>[0];
type R2BucketBinding = {
  put: (
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: {
      httpMetadata?: {
        contentType?: string;
        cacheControl?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ) => Promise<{ key: string }>;
  get: (key: string) => Promise<
    | {
        body: ReadableStream;
        httpMetadata?: {
          contentType?: string;
          cacheControl?: string;
        };
        writeHttpMetadata?: (headers: Headers) => void;
      }
    | null
  >;
};

type ImagesBinding = {
  input: (
    stream: ReadableStream<Uint8Array>,
    options?: { encoding?: 'base64' },
  ) => {
    transform: (transform: {
      width?: number;
      height?: number;
      fit?: 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad' | 'squeeze';
      gravity?: 'face' | 'left' | 'right' | 'top' | 'bottom' | 'center' | 'auto' | 'entropy';
    }) => {
      output: (options: {
        format:
          | 'image/jpeg'
          | 'image/png'
          | 'image/gif'
          | 'image/webp'
          | 'image/avif'
          | 'rgb'
          | 'rgba';
        quality?: number;
        background?: string;
        anim?: boolean;
      }) => Promise<{
        contentType: () => string;
        image: (options?: { encoding?: 'base64' }) => ReadableStream<Uint8Array>;
      }>;
    };
  };
};

export type BackendWorkerEnv = AuthRuntimeEnv & {
  DB: D1DatabaseBinding;
  BETTER_AUTH_COOKIE_DOMAIN?: string;
  PUBLIC_EVENTS_ORGANIZATION_SLUG?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  ORG_LOGO_BUCKET?: R2BucketBinding;
  SERVICE_IMAGE_BUCKET?: R2BucketBinding;
  IMAGES?: ImagesBinding;
  ORG_LOGO_PUBLIC_BASE_URL?: string;
  ORG_LOGO_MAX_UPLOAD_BYTES?: string;
  SERVICE_IMAGE_PUBLIC_BASE_URL?: string;
  SERVICE_IMAGE_MAX_UPLOAD_BYTES?: string;
  SERVICE_IMAGE_UPLOAD_TOKEN_TTL_SECONDS?: string;
  SERVICE_IMAGE_UPLOAD_SIGNING_SECRET?: string;
  SENTRY_DSN_BACKEND?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
};

export const createWorkerAuthRuntime = (env: BackendWorkerEnv) => {
  const db = drizzle(env.DB);

  return createAuthRuntime({
    database: db,
    env,
  });
};
