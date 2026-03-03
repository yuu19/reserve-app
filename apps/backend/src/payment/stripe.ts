import type { AuthRuntimeEnv } from '../auth-runtime.js';

type StripeCheckoutSessionCreateInput = {
  env: AuthRuntimeEnv;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId?: string;
  metadata?: Record<string, string>;
};

export type StripeCheckoutSession = {
  id: string;
  url: string;
  paymentStatus?: string;
  status?: string;
};

export type StripeWebhookEvent = {
  id: string;
  type: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

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

const parseStripeSignatureHeader = (header: string) => {
  const timestampCandidates: string[] = [];
  const v1Signatures: string[] = [];

  for (const part of header.split(',')) {
    const [rawKey, rawValue] = part.split('=', 2);
    const key = rawKey?.trim();
    const value = rawValue?.trim();
    if (!key || !value) {
      continue;
    }
    if (key === 't') {
      timestampCandidates.push(value);
      continue;
    }
    if (key === 'v1') {
      v1Signatures.push(value);
    }
  }

  return {
    timestamp: timestampCandidates[0] ?? null,
    v1Signatures,
  };
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

const toStripeErrorMessage = (payload: unknown): string => {
  if (!isRecord(payload)) {
    return 'Stripe API request failed.';
  }

  const error = payload.error;
  if (!isRecord(error)) {
    return 'Stripe API request failed.';
  }

  if (typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }

  return 'Stripe API request failed.';
};

export const createCheckoutSession = async ({
  env,
  priceId,
  successUrl,
  cancelUrl,
  clientReferenceId,
  metadata,
}: StripeCheckoutSessionCreateInput): Promise<StripeCheckoutSession> => {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');

  if (clientReferenceId) {
    params.set('client_reference_id', clientReferenceId);
  }

  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      params.set(`metadata[${key}]`, value);
    }
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(toStripeErrorMessage(payload));
  }

  if (!isRecord(payload) || typeof payload.id !== 'string' || typeof payload.url !== 'string') {
    throw new Error('Invalid Stripe checkout session response.');
  }

  return {
    id: payload.id,
    url: payload.url,
    paymentStatus: typeof payload.payment_status === 'string' ? payload.payment_status : undefined,
    status: typeof payload.status === 'string' ? payload.status : undefined,
  };
};

export const verifyStripeWebhookSignature = async ({
  rawBody,
  signatureHeader,
  webhookSecret,
  toleranceSeconds = 300,
}: {
  rawBody: string;
  signatureHeader: string | null;
  webhookSecret?: string;
  toleranceSeconds?: number;
}): Promise<boolean> => {
  const secret = webhookSecret?.trim();
  if (!secret || !signatureHeader) {
    return false;
  }

  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed.timestamp || parsed.v1Signatures.length === 0) {
    return false;
  }

  const timestampSeconds = Number(parsed.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) {
    return false;
  }

  const signedPayload = `${parsed.timestamp}.${rawBody}`;
  const expected = await hmacSha256Hex(secret, signedPayload);

  return parsed.v1Signatures.some((candidate) => timingSafeEqual(candidate, expected));
};

export const parseStripeWebhookEvent = (rawBody: string): StripeWebhookEvent | null => {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!isRecord(parsed) || typeof parsed.id !== 'string' || typeof parsed.type !== 'string') {
      return null;
    }

    const data = isRecord(parsed.data)
      ? {
          object: isRecord(parsed.data.object)
            ? (parsed.data.object as Record<string, unknown>)
            : undefined,
        }
      : undefined;

    return {
      id: parsed.id,
      type: parsed.type,
      data,
    };
  } catch {
    return null;
  }
};
