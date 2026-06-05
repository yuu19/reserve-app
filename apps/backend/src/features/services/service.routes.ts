import type { BookingRouteContext } from '../booking/booking-route-context.js';
import { jsonRouteResult } from '../../shared/route-result.js';
import {
  archiveServiceRoute,
  createServiceImageUploadUrlRoute,
  createServiceRoute,
  getServiceImageRoute,
  listServicesRoute,
  updateServiceRoute,
  uploadServiceImageBySignedUrlRoute,
} from './service.schemas.js';
import {
  createServiceImageUploadUrl,
  getServiceImage,
  uploadServiceImageBySignedUrl,
} from './service-image.usecases.js';
import {
  archiveExistingService,
  createService,
  listManageableServices,
  updateExistingService,
} from './service.usecases.js';

/**
 * service 管理と service image 配信に関する OpenAPI route を認証済み Hono app に登録します。
 *
 * @remarks
 * 画像 upload/download は R2 連携サービスの有無で 503 を返し、通常の service CRUD は usecase 層へ委譲します。
 */
export const registerServiceRoutes = (ctx: BookingRouteContext) => {
  const withScope = <T extends Record<string, unknown>>(
    scope: NonNullable<Awaited<ReturnType<BookingRouteContext['resolveScopedStoreContext']>>>,
    input: T,
  ) => ({
    ...input,
    organizationId: scope.organizationId,
    storeId: scope.storeId,
  });

  ctx.authRoutes.openapi(createServiceImageUploadUrlRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await createServiceImageUploadUrl(
        ctx,
        withScope(scope, c.req.valid('json')),
        c.req.raw.headers,
      ),
    );
  });

  ctx.authRoutes.openapi(uploadServiceImageBySignedUrlRoute, async (c) =>
    jsonRouteResult(
      c,
      await uploadServiceImageBySignedUrl(ctx, c.req.valid('param').token, c.req.raw),
    ),
  );

  ctx.authRoutes.openapi(getServiceImageRoute, async (c) => {
    return getServiceImage(ctx, c.req.valid('param').key);
  });

  ctx.authRoutes.openapi(createServiceRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await createService(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(listServicesRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await listManageableServices(ctx, withScope(scope, c.req.valid('query')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(updateServiceRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await updateExistingService(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });

  ctx.authRoutes.openapi(archiveServiceRoute, async (c) => {
    const scope = await ctx.resolveScopedStoreContext(c.req.valid('param'));
    if (!scope) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    return jsonRouteResult(
      c,
      await archiveExistingService(ctx, withScope(scope, c.req.valid('json')), c.req.raw.headers),
    );
  });
};
