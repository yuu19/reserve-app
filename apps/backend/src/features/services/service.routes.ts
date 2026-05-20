import type { BookingRouteContext } from '../../shared/route-context.js';
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
  ctx.authRoutes.openapi(createServiceImageUploadUrlRoute, async (c) =>
    jsonRouteResult(
      c,
      await createServiceImageUploadUrl(ctx, c.req.valid('json'), c.req.raw.headers),
    ),
  );

  ctx.authRoutes.openapi(uploadServiceImageBySignedUrlRoute, async (c) =>
    jsonRouteResult(
      c,
      await uploadServiceImageBySignedUrl(ctx, c.req.valid('param').token, c.req.raw),
    ),
  );

  ctx.authRoutes.openapi(getServiceImageRoute, async (c) => {
    return getServiceImage(ctx, c.req.valid('param').key);
  });

  ctx.authRoutes.openapi(createServiceRoute, async (c) =>
    jsonRouteResult(c, await createService(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(listServicesRoute, async (c) =>
    jsonRouteResult(c, await listManageableServices(ctx, c.req.valid('query'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(updateServiceRoute, async (c) =>
    jsonRouteResult(c, await updateExistingService(ctx, c.req.valid('json'), c.req.raw.headers)),
  );

  ctx.authRoutes.openapi(archiveServiceRoute, async (c) =>
    jsonRouteResult(c, await archiveExistingService(ctx, c.req.valid('json'), c.req.raw.headers)),
  );
};
