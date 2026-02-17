type OrganizationLogoEnv = {
  IMAGES?: {
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
  ORG_LOGO_BUCKET?: {
    put: (
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
      options?: {
        httpMetadata?: {
          contentType?: string;
          cacheControl?: string;
          contentDisposition?: string;
          contentEncoding?: string;
          contentLanguage?: string;
          contentTypeDefaulted?: boolean;
          cacheExpiry?: Date;
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
  BETTER_AUTH_URL?: string;
  ORG_LOGO_PUBLIC_BASE_URL?: string;
  ORG_LOGO_MAX_UPLOAD_BYTES?: string;
};

type UploadOrganizationLogoInput = {
  file: File;
  ownerUserId: string;
};

type UploadOrganizationLogoResult = {
  key: string;
  logoUrl: string;
  contentType: string;
  originalContentType: string;
  size: number;
};

type OrganizationLogoObject = {
  body: ReadableStream;
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
  writeHttpMetadata?: (headers: Headers) => void;
};

export type OrganizationLogoService = {
  upload: (input: UploadOrganizationLogoInput) => Promise<UploadOrganizationLogoResult>;
  get: (key: string) => Promise<OrganizationLogoObject | null>;
};

const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_LOGO_DIMENSION = 512;
const DEFAULT_OUTPUT_QUALITY = 85;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

const parsePositiveInt = (value: string | undefined, fallback: number) => {
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

const resolveLogoUrl = ({
  key,
  env,
}: {
  key: string;
  env: Pick<OrganizationLogoEnv, 'BETTER_AUTH_URL' | 'ORG_LOGO_PUBLIC_BASE_URL'>;
}) => {
  if (env.ORG_LOGO_PUBLIC_BASE_URL) {
    return `${trimTrailingSlash(env.ORG_LOGO_PUBLIC_BASE_URL)}/${encodeURIComponent(key)}`;
  }

  const backendBaseUrl = trimTrailingSlash(env.BETTER_AUTH_URL ?? 'http://localhost:3000');
  return `${backendBaseUrl}/api/v1/auth/organizations/logo/${encodeURIComponent(key)}`;
};

const createLogoObjectKey = (ownerUserId: string) => {
  const ownerIdPrefix = ownerUserId.slice(0, 8).replace(/[^a-zA-Z0-9_-]/g, 'x') || 'user';
  return `org-logo-${ownerIdPrefix}-${crypto.randomUUID()}.webp`;
};

export const createOrganizationLogoService = (
  env: OrganizationLogoEnv,
): OrganizationLogoService | null => {
  if (!env.ORG_LOGO_BUCKET || !env.IMAGES) {
    return null;
  }

  const images = env.IMAGES;
  const bucket = env.ORG_LOGO_BUCKET;
  const maxUploadBytes = parsePositiveInt(env.ORG_LOGO_MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES);

  return {
    async upload({ file, ownerUserId }) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        throw new Error('Unsupported image type. Use jpeg, png, webp or avif.');
      }

      if (file.size <= 0) {
        throw new Error('Image file is empty.');
      }

      if (file.size > maxUploadBytes) {
        throw new Error(`Image file is too large. Max size is ${maxUploadBytes} bytes.`);
      }

      const transformed = await images.input(file.stream() as ReadableStream<Uint8Array>)
        .transform({
          width: DEFAULT_MAX_LOGO_DIMENSION,
          height: DEFAULT_MAX_LOGO_DIMENSION,
          fit: 'cover',
          gravity: 'auto',
        })
        .output({
          format: 'image/webp',
          quality: DEFAULT_OUTPUT_QUALITY,
          anim: false,
        });

      const key = createLogoObjectKey(ownerUserId);
      const contentType = transformed.contentType();

      await bucket.put(key, transformed.image(), {
        httpMetadata: {
          contentType,
          cacheControl: 'public, max-age=31536000, immutable',
        },
        customMetadata: {
          sourceContentType: file.type,
          ownerUserId,
        },
      });

      return {
        key,
        logoUrl: resolveLogoUrl({ key, env }),
        contentType,
        originalContentType: file.type,
        size: file.size,
      };
    },
    async get(key) {
      return bucket.get(key);
    },
  };
};
