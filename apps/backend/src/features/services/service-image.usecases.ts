import { resolveOrganizationId } from '../../domain/booking/authorization.js';
import { ServiceImageUploadError } from '../../infra/storage/service-image-upload-service.js';
import {
  forbidden,
  jsonResult,
  notFound,
  unauthorized,
  validationError,
  type JsonRouteResult,
  type JsonStatus,
} from '../../shared/route-result.js';
import type { BookingRouteContext } from '../booking/booking-route-context.js';
import type { ServiceImageUploadUrlBody } from './service.schemas.js';

const serviceImageUploadErrorStatus = (status: number): JsonStatus => {
  if (status === 401 || status === 413 || status === 503) {
    return status;
  }
  return 400;
};

const serviceImageTextResponse = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=UTF-8',
    },
  });

const jsonServiceImageUploadError = (
  error: ServiceImageUploadError,
): JsonRouteResult<{ message: string }> =>
  jsonResult({ message: error.message }, serviceImageUploadErrorStatus(error.status));

/**
 * service image の署名付き upload URL を、認証・store 権限確認後に発行します。
 */
export const createServiceImageUploadUrl = async (
  ctx: BookingRouteContext,
  body: ServiceImageUploadUrlBody,
  headers: Headers,
): Promise<JsonRouteResult> => {
  if (!ctx.serviceImageUploadService) {
    return jsonResult({ message: 'Service image upload is not configured.' }, 503);
  }

  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return unauthorized();
  }

  const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
  if (!organizationId) {
    return validationError('organizationId is required.');
  }

  const storeContext = await ctx.resolveRequestedStoreContext({
    organizationId,
    storeId: body.storeId,
  });
  if (!storeContext) {
    return notFound('Store not found.');
  }

  const hasAccess = await ctx.canManageStoreScope({
    organizationId,
    storeId: body.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return forbidden();
  }

  try {
    const uploadUrl = await ctx.serviceImageUploadService.createSignedUploadUrl({
      ownerUserId: identity.userId,
      organizationId,
      fileName: body.fileName,
      contentType: body.contentType,
      size: body.size,
    });
    return jsonResult(uploadUrl);
  } catch (error) {
    if (error instanceof ServiceImageUploadError) {
      return jsonServiceImageUploadError(error);
    }
    throw error;
  }
};

/**
 * 署名付き token を検証し、service image を object storage に保存します。
 */
export const uploadServiceImageBySignedUrl = async (
  ctx: BookingRouteContext,
  token: string,
  request: Request,
): Promise<JsonRouteResult> => {
  if (!ctx.serviceImageUploadService) {
    return jsonResult({ message: 'Service image upload is not configured.' }, 503);
  }

  try {
    const uploaded = await ctx.serviceImageUploadService.uploadBySignedUrl(token, request);
    return jsonResult(uploaded, 201);
  } catch (error) {
    if (error instanceof ServiceImageUploadError) {
      return jsonServiceImageUploadError(error);
    }
    throw error;
  }
};

/**
 * 保存済み service image を配信します。
 */
export const getServiceImage = async (ctx: BookingRouteContext, key: string): Promise<Response> => {
  if (!ctx.serviceImageUploadService) {
    return serviceImageTextResponse('Service image delivery is not configured.', 503);
  }

  const object = await ctx.serviceImageUploadService.get(key);
  if (!object) {
    return serviceImageTextResponse('Service image not found.', 404);
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
};
