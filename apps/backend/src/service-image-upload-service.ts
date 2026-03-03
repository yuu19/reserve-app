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

type ServiceImageUploadEnv = {
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  SERVICE_IMAGE_UPLOAD_SIGNING_SECRET?: string;
  SERVICE_IMAGE_PUBLIC_BASE_URL?: string;
  SERVICE_IMAGE_MAX_UPLOAD_BYTES?: string;
  SERVICE_IMAGE_UPLOAD_TOKEN_TTL_SECONDS?: string;
  SERVICE_IMAGE_BUCKET?: R2BucketBinding;
  ORG_LOGO_BUCKET?: R2BucketBinding;
};

type UploadTokenPayload = {
  key: string;
  ownerUserId: string;
  organizationId: string;
  contentType: string;
  maxUploadBytes: number;
  expiresAtMs: number;
};

export type CreateServiceImageUploadUrlInput = {
  ownerUserId: string;
  organizationId: string;
  contentType: string;
  size: number;
  fileName?: string;
};

export type CreateServiceImageUploadUrlResult = {
  key: string;
  uploadUrl: string;
  imageUrl: string;
  expiresAt: string;
  contentType: string;
  maxUploadBytes: number;
};

export type UploadServiceImageBySignedUrlResult = {
  key: string;
  imageUrl: string;
  contentType: string;
  size: number;
};

type ServiceImageObject = {
  body: ReadableStream;
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
  writeHttpMetadata?: (headers: Headers) => void;
};

export class ServiceImageUploadError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ServiceImageUploadError';
    this.status = status;
  }
}

export type ServiceImageUploadService = {
  createSignedUploadUrl: (
    input: CreateServiceImageUploadUrlInput,
  ) => Promise<CreateServiceImageUploadUrlResult>;
  uploadBySignedUrl: (
    token: string,
    request: Request,
  ) => Promise<UploadServiceImageBySignedUrlResult>;
  get: (key: string) => Promise<ServiceImageObject | null>;
};

const DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const DEFAULT_UPLOAD_TOKEN_TTL_SECONDS = 300;
const DEFAULT_BACKEND_BASE_URL = 'http://localhost:3000';

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

const CONTENT_TYPE_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const normalizeContentType = (value: string): string => value.split(';', 1)[0]?.trim().toLowerCase() ?? '';

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const timingSafeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
};

const base64UrlEncodeUtf8 = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

const base64UrlDecodeUtf8 = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');

const createObjectKey = ({
  organizationId,
  contentType,
}: {
  organizationId: string;
  contentType: string;
}) => {
  const orgPrefix = organizationId.slice(0, 8).replace(/[^a-zA-Z0-9_-]/g, 'x') || 'org';
  const extension = CONTENT_TYPE_EXTENSION_MAP[contentType] ?? 'bin';
  return `service-image-${orgPrefix}-${crypto.randomUUID()}.${extension}`;
};

const resolveImageUrl = ({
  key,
  env,
}: {
  key: string;
  env: Pick<ServiceImageUploadEnv, 'BETTER_AUTH_URL' | 'SERVICE_IMAGE_PUBLIC_BASE_URL'>;
}) => {
  if (env.SERVICE_IMAGE_PUBLIC_BASE_URL) {
    return `${trimTrailingSlash(env.SERVICE_IMAGE_PUBLIC_BASE_URL)}/${encodeURIComponent(key)}`;
  }

  const backendBaseUrl = trimTrailingSlash(env.BETTER_AUTH_URL ?? DEFAULT_BACKEND_BASE_URL);
  return `${backendBaseUrl}/api/v1/auth/organizations/services/images/${encodeURIComponent(key)}`;
};

const parseUploadToken = (token: string): { payloadBase64: string; signatureHex: string } => {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ServiceImageUploadError('Invalid upload token.', 400);
  }

  return {
    payloadBase64: parts[0],
    signatureHex: parts[1],
  };
};

const parseUploadTokenPayload = (encodedPayload: string): UploadTokenPayload => {
  try {
    const parsed = JSON.parse(base64UrlDecodeUtf8(encodedPayload)) as Partial<UploadTokenPayload>;
    if (
      typeof parsed.key !== 'string' ||
      typeof parsed.ownerUserId !== 'string' ||
      typeof parsed.organizationId !== 'string' ||
      typeof parsed.contentType !== 'string' ||
      typeof parsed.maxUploadBytes !== 'number' ||
      typeof parsed.expiresAtMs !== 'number'
    ) {
      throw new ServiceImageUploadError('Invalid upload token payload.', 400);
    }
    return {
      key: parsed.key,
      ownerUserId: parsed.ownerUserId,
      organizationId: parsed.organizationId,
      contentType: parsed.contentType,
      maxUploadBytes: parsed.maxUploadBytes,
      expiresAtMs: parsed.expiresAtMs,
    };
  } catch (error) {
    if (error instanceof ServiceImageUploadError) {
      throw error;
    }
    throw new ServiceImageUploadError('Invalid upload token payload.', 400);
  }
};

const hmacSha256Hex = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return toHex(signature);
};

const assertAllowedContentType = (contentType: string) => {
  const normalized = normalizeContentType(contentType);
  if (!ALLOWED_IMAGE_TYPES.has(normalized)) {
    throw new ServiceImageUploadError('Unsupported image type. Use jpeg, png, webp or avif.', 400);
  }
  return normalized;
};

export const createServiceImageUploadService = (
  env: ServiceImageUploadEnv,
): ServiceImageUploadService | null => {
  const bucket = env.SERVICE_IMAGE_BUCKET ?? env.ORG_LOGO_BUCKET;
  const signingSecret = env.SERVICE_IMAGE_UPLOAD_SIGNING_SECRET?.trim() || env.BETTER_AUTH_SECRET?.trim();
  if (!bucket || !signingSecret) {
    return null;
  }

  const maxUploadBytes = parsePositiveInt(env.SERVICE_IMAGE_MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES);
  const tokenTtlSeconds = parsePositiveInt(
    env.SERVICE_IMAGE_UPLOAD_TOKEN_TTL_SECONDS,
    DEFAULT_UPLOAD_TOKEN_TTL_SECONDS,
  );

  return {
    async createSignedUploadUrl({
      ownerUserId,
      organizationId,
      contentType,
      size,
    }: CreateServiceImageUploadUrlInput) {
      const normalizedContentType = assertAllowedContentType(contentType);
      if (!Number.isFinite(size) || size <= 0) {
        throw new ServiceImageUploadError('Image file is empty.', 400);
      }
      if (size > maxUploadBytes) {
        throw new ServiceImageUploadError(
          `Image file is too large. Max size is ${maxUploadBytes} bytes.`,
          400,
        );
      }

      const key = createObjectKey({
        organizationId,
        contentType: normalizedContentType,
      });
      const expiresAtMs = Date.now() + tokenTtlSeconds * 1000;
      const payloadBase64 = base64UrlEncodeUtf8(
        JSON.stringify({
          key,
          ownerUserId,
          organizationId,
          contentType: normalizedContentType,
          maxUploadBytes,
          expiresAtMs,
        } satisfies UploadTokenPayload),
      );
      const signatureHex = await hmacSha256Hex(signingSecret, payloadBase64);
      const token = `${payloadBase64}.${signatureHex}`;
      const uploadUrlBase = trimTrailingSlash(env.BETTER_AUTH_URL ?? DEFAULT_BACKEND_BASE_URL);

      return {
        key,
        uploadUrl: `${uploadUrlBase}/api/v1/auth/organizations/services/images/upload/${token}`,
        imageUrl: resolveImageUrl({ key, env }),
        expiresAt: new Date(expiresAtMs).toISOString(),
        contentType: normalizedContentType,
        maxUploadBytes,
      };
    },
    async uploadBySignedUrl(token, request) {
      const { payloadBase64, signatureHex } = parseUploadToken(token);
      const expectedSignature = await hmacSha256Hex(signingSecret, payloadBase64);
      if (!timingSafeEqual(signatureHex, expectedSignature)) {
        throw new ServiceImageUploadError('Invalid upload signature.', 401);
      }

      const payload = parseUploadTokenPayload(payloadBase64);
      if (Date.now() > payload.expiresAtMs) {
        throw new ServiceImageUploadError('Upload token has expired.', 401);
      }

      const contentTypeHeader = request.headers.get('content-type');
      const normalizedContentType = assertAllowedContentType(contentTypeHeader ?? '');
      if (normalizedContentType !== payload.contentType) {
        throw new ServiceImageUploadError('Content type mismatch for signed upload.', 400);
      }

      if (!request.body) {
        throw new ServiceImageUploadError('Image request body is required.', 400);
      }

      const contentLengthHeader = request.headers.get('content-length');
      if (contentLengthHeader) {
        const contentLength = Number.parseInt(contentLengthHeader, 10);
        if (Number.isFinite(contentLength) && contentLength > payload.maxUploadBytes) {
          throw new ServiceImageUploadError(
            `Image file is too large. Max size is ${payload.maxUploadBytes} bytes.`,
            413,
          );
        }
      }

      const imageBuffer = await request.arrayBuffer();
      if (imageBuffer.byteLength <= 0) {
        throw new ServiceImageUploadError('Image file is empty.', 400);
      }
      if (imageBuffer.byteLength > payload.maxUploadBytes) {
        throw new ServiceImageUploadError(
          `Image file is too large. Max size is ${payload.maxUploadBytes} bytes.`,
          413,
        );
      }

      await bucket.put(payload.key, imageBuffer, {
        httpMetadata: {
          contentType: payload.contentType,
          cacheControl: 'public, max-age=31536000, immutable',
        },
        customMetadata: {
          ownerUserId: payload.ownerUserId,
          organizationId: payload.organizationId,
        },
      });

      return {
        key: payload.key,
        imageUrl: resolveImageUrl({ key: payload.key, env }),
        contentType: payload.contentType,
        size: imageBuffer.byteLength,
      };
    },
    async get(key) {
      return bucket.get(key);
    },
  };
};
