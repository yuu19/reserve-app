import { resolveOrganizationId } from '../../booking/authorization.js';
import { ServiceImageUploadError } from '../../service-image-upload-service.js';
import type { BookingRouteContext } from '../shared/route-context.js';
import { jsonRouteResult } from '../shared/route-result.js';
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
  archiveExistingService,
  createService,
  listManageableServices,
  updateExistingService,
} from './service.usecases.js';

export const registerServiceRoutes = (ctx: BookingRouteContext) => {
  ctx.authRoutes.openapi(createServiceImageUploadUrlRoute, async (c) => {
    if (!ctx.serviceImageUploadService) {
      return c.json({ message: 'Service image upload is not configured.' }, 503);
    }

    const body = c.req.valid('json');
    const identity = await ctx.requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(
      body.organizationId,
      identity.activeOrganizationId,
    );
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const classroomContext = await ctx.resolveRequestedClassroomContext({
      organizationId,
      classroomId: body.classroomId,
    });
    if (!classroomContext) {
      return c.json({ message: 'Classroom not found.' }, 404);
    }

    const hasAccess = await ctx.canManageClassroomScope({
      organizationId,
      classroomId: body.classroomId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    try {
      const uploadUrl = await ctx.serviceImageUploadService.createSignedUploadUrl({
        ownerUserId: identity.userId,
        organizationId,
        fileName: body.fileName,
        contentType: body.contentType,
        size: body.size,
      });
      return c.json(uploadUrl, 200);
    } catch (error) {
      if (error instanceof ServiceImageUploadError) {
        return c.json({ message: error.message }, error.status as 400 | 401 | 413 | 503);
      }
      throw error;
    }
  });

  ctx.authRoutes.openapi(uploadServiceImageBySignedUrlRoute, async (c) => {
    if (!ctx.serviceImageUploadService) {
      return c.json({ message: 'Service image upload is not configured.' }, 503);
    }

    const { token } = c.req.valid('param');
    try {
      const uploaded = await ctx.serviceImageUploadService.uploadBySignedUrl(token, c.req.raw);
      return c.json(uploaded, 201);
    } catch (error) {
      if (error instanceof ServiceImageUploadError) {
        return c.json({ message: error.message }, error.status as 400 | 401 | 413 | 503);
      }
      throw error;
    }
  });

  ctx.authRoutes.openapi(getServiceImageRoute, async (c) => {
    if (!ctx.serviceImageUploadService) {
      return c.text('Service image delivery is not configured.', 503);
    }

    const { key } = c.req.valid('param');
    const object = await ctx.serviceImageUploadService.get(key);
    if (!object) {
      return c.text('Service image not found.', 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata?.(headers);
    headers.set('content-type', object.httpMetadata?.contentType ?? 'image/webp');
    headers.set(
      'cache-control',
      object.httpMetadata?.cacheControl ?? 'public, max-age=31536000, immutable',
    );

    return new Response(object.body, {
      status: 200,
      headers,
    });
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
