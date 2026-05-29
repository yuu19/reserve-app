import { describe, expect, it, vi } from 'vitest';
import { ServiceImageUploadError } from '../../infra/storage/service-image-upload-service.js';
import type { BookingRouteContext } from '../booking/booking-route-context.js';
import {
  createServiceImageUploadUrl,
  getServiceImage,
  uploadServiceImageBySignedUrl,
} from './service-image.usecases.js';

const createContext = (overrides: Partial<BookingRouteContext> = {}): BookingRouteContext => {
  const serviceImageUploadService = {
    createSignedUploadUrl: vi.fn(async () => ({
      key: 'service-image-organization-test.webp',
      uploadUrl: 'https://backend.test/upload/token',
      imageUrl: 'https://backend.test/images/service-image-organization-test.webp',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      contentType: 'image/webp',
      maxUploadBytes: 8 * 1024 * 1024,
    })),
    uploadBySignedUrl: vi.fn(async () => ({
      key: 'service-image-organization-test.webp',
      imageUrl: 'https://backend.test/images/service-image-organization-test.webp',
      contentType: 'image/webp',
      size: 128,
    })),
    get: vi.fn(async () => ({
      body: new Response('image-body').body as ReadableStream<Uint8Array>,
      httpMetadata: {
        contentType: 'image/webp',
        cacheControl: 'public, max-age=60',
      },
    })),
  };

  return {
    authRoutes: null as never,
    auth: null as never,
    database: null as never,
    env: {},
    serviceImageUploadService,
    requireIdentity: vi.fn(async () => ({
      userId: 'user-1',
      activeOrganizationId: 'organization-1',
    })),
    resolveRequestedStoreContext: vi.fn(async () => ({
      organizationId: 'organization-1',
      organizationSlug: 'organization',
      organizationName: 'Organization',
      storeId: 'store-1',
      storeSlug: 'store',
      storeName: 'Store',
    })),
    resolveRequestedStoreAccess: vi.fn(),
    canManageStoreScope: vi.fn(async () => true),
    canManageBookingsScope: vi.fn(),
    canManageParticipantsScope: vi.fn(),
    canReadServicesScope: vi.fn(),
    canReadTicketTypesScope: vi.fn(),
    listParticipantRecordsForUser: vi.fn(),
    requireOrganizationPremiumFeature: vi.fn(),
    ...overrides,
  } as unknown as BookingRouteContext;
};

describe('service image usecases', () => {
  it('returns 503 before auth work when service image upload is not configured', async () => {
    const requireIdentity = vi.fn();
    const ctx = createContext({
      serviceImageUploadService: null,
      requireIdentity,
    });

    const result = await createServiceImageUploadUrl(
      ctx,
      {
        organizationId: 'organization-1',
        contentType: 'image/webp',
        size: 128,
      },
      new Headers(),
    );

    expect(result).toEqual({
      status: 503,
      body: { message: 'Service image upload is not configured.' },
    });
    expect(requireIdentity).not.toHaveBeenCalled();
  });

  it('keeps image upload authorization checks in the usecase', async () => {
    const createSignedUploadUrl = vi.fn();
    const ctx = createContext({
      serviceImageUploadService: {
        createSignedUploadUrl,
        uploadBySignedUrl: vi.fn(),
        get: vi.fn(),
      },
      canManageStoreScope: vi.fn(async () => false),
    });

    const result = await createServiceImageUploadUrl(
      ctx,
      {
        organizationId: 'organization-1',
        storeId: 'store-1',
        contentType: 'image/webp',
        size: 128,
      },
      new Headers(),
    );

    expect(result).toEqual({
      status: 403,
      body: { message: 'Forbidden' },
    });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('maps ServiceImageUploadError status and message for signed URL creation', async () => {
    const ctx = createContext();
    vi.mocked(ctx.serviceImageUploadService?.createSignedUploadUrl).mockRejectedValue(
      new ServiceImageUploadError('Image file is too large.', 413),
    );

    const result = await createServiceImageUploadUrl(
      ctx,
      {
        organizationId: 'organization-1',
        contentType: 'image/webp',
        size: 128,
      },
      new Headers(),
    );

    expect(result).toEqual({
      status: 413,
      body: { message: 'Image file is too large.' },
    });
  });

  it('maps signed upload service errors without route-level exception handling', async () => {
    const ctx = createContext();
    vi.mocked(ctx.serviceImageUploadService?.uploadBySignedUrl).mockRejectedValue(
      new ServiceImageUploadError('Invalid upload signature.', 401),
    );

    const result = await uploadServiceImageBySignedUrl(
      ctx,
      'signed-token',
      new Request('https://backend.test/upload', { method: 'PUT', body: 'image' }),
    );

    expect(result).toEqual({
      status: 401,
      body: { message: 'Invalid upload signature.' },
    });
  });

  it('returns service image response with object metadata headers', async () => {
    const ctx = createContext();

    const response = await getServiceImage(ctx, 'service-image-organization-test.webp');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await response.text()).toBe('image-body');
  });
});
