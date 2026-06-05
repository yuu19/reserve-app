import { createRoute, z } from '@hono/zod-openapi';
import {
  scopedStoreAuthPath,
  scopedStoreRouteParamsSchema,
} from '../../shared/scoped-store-route.js';

const boolStringSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

const serviceKindSchema = z.enum(['single', 'recurring']);
const bookingPolicySchema = z.enum(['instant', 'approval']);
const servicePublicStatusSchema = z.enum(['public', 'private', 'suspended']);

/**
 * service 作成 API の入力を検証します。
 */
export const serviceCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  kind: serviceKindSchema,
  durationMinutes: z
    .int()
    .min(1)
    .max(24 * 60),
  capacity: z.int().min(1).max(500),
  bookingOpenMinutesBefore: z
    .int()
    .min(0)
    .max(365 * 24 * 60)
    .optional(),
  bookingCloseMinutesBefore: z
    .int()
    .min(0)
    .max(365 * 24 * 60)
    .optional(),
  cancellationDeadlineMinutes: z
    .int()
    .min(0)
    .max(365 * 24 * 60)
    .optional(),
  timezone: z.string().optional(),
  bookingPolicy: bookingPolicySchema.optional(),
  requiresTicket: z.boolean().optional(),
  publicStatus: servicePublicStatusSchema.optional(),
  imageUrl: z.string().trim().max(2048).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * service 一覧 API の query を検証します。
 */
export const serviceListQuerySchema = z.object({
  includeArchived: boolStringSchema,
});

/**
 * service 更新 API の入力を、部分更新として検証します。
 */
export const serviceUpdateBodySchema = z.object({
  serviceId: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  kind: serviceKindSchema.optional(),
  durationMinutes: z
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
  capacity: z.int().min(1).max(500).optional(),
  bookingOpenMinutesBefore: z
    .int()
    .min(0)
    .max(365 * 24 * 60)
    .optional(),
  bookingCloseMinutesBefore: z
    .int()
    .min(0)
    .max(365 * 24 * 60)
    .optional(),
  cancellationDeadlineMinutes: z
    .int()
    .min(0)
    .max(365 * 24 * 60)
    .optional(),
  timezone: z.string().optional(),
  bookingPolicy: bookingPolicySchema.optional(),
  requiresTicket: z.boolean().optional(),
  publicStatus: servicePublicStatusSchema.optional(),
  imageUrl: z.string().trim().max(2048).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * service image の署名付き upload URL 発行に必要な入力を検証します。
 */
export const serviceImageUploadUrlBodySchema = z.object({
  fileName: z.string().trim().min(1).max(255).optional(),
  contentType: z.string().trim().min(1).max(120),
  size: z.int().min(1),
});

/**
 * 署名付き service image upload route の token path param を検証します。
 */
export const serviceImageUploadTokenParamSchema = z.object({
  token: z.string().trim().min(20).max(4096),
});

/**
 * service image 配信 route の object key path param を検証します。
 */
export const serviceImageKeyParamSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]+$/)
    .min(1)
    .max(255),
});

/**
 * service archive API の入力を検証します。
 */
export const serviceArchiveBodySchema = z.object({
  serviceId: z.string().min(1),
});

type ScopedStoreInput = {
  organizationId: string;
  storeId: string;
};

/**
 * service 作成 usecase が受け取る検証済み body 型です。
 */
export type ServiceCreateBody = z.infer<typeof serviceCreateBodySchema> & ScopedStoreInput;
/**
 * service 一覧 usecase が受け取る検証済み query 型です。
 */
export type ServiceListQuery = z.infer<typeof serviceListQuerySchema> & ScopedStoreInput;
/**
 * service 更新 usecase が受け取る検証済み body 型です。
 */
export type ServiceUpdateBody = z.infer<typeof serviceUpdateBodySchema> & ScopedStoreInput;
/**
 * service archive usecase が受け取る検証済み body 型です。
 */
export type ServiceArchiveBody = z.infer<typeof serviceArchiveBodySchema> & ScopedStoreInput;
/**
 * service image upload URL 発行 route が受け取る検証済み body 型です。
 */
export type ServiceImageUploadUrlBody = z.infer<typeof serviceImageUploadUrlBodySchema> &
  ScopedStoreInput;

/**
 * service を作成する OpenAPI 定義です。
 */
export const createServiceRoute = createRoute({
  method: 'post',
  path: scopedStoreAuthPath('/services'),
  tags: ['Services'],
  summary: 'Create service',
  request: {
    params: scopedStoreRouteParamsSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: serviceCreateBodySchema } },
    },
  },
  responses: {
    200: { description: 'Service created' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    422: { description: 'Validation error' },
  },
});

/**
 * 管理者・スタッフ向け service 一覧の OpenAPI 定義です。
 */
export const listServicesRoute = createRoute({
  method: 'get',
  path: scopedStoreAuthPath('/services'),
  tags: ['Services'],
  summary: 'List services',
  request: { params: scopedStoreRouteParamsSchema, query: serviceListQuerySchema },
  responses: {
    200: { description: 'Service list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

/**
 * service image 用の署名付き upload URL を発行する OpenAPI 定義です。
 */
export const createServiceImageUploadUrlRoute = createRoute({
  method: 'post',
  path: scopedStoreAuthPath('/services/images/upload-url'),
  tags: ['Services'],
  summary: 'Create signed upload URL for service image',
  request: {
    params: scopedStoreRouteParamsSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: serviceImageUploadUrlBodySchema } },
    },
  },
  responses: {
    200: { description: 'Signed upload URL created' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    422: { description: 'Validation error' },
    503: { description: 'Service image upload not configured' },
  },
});

/**
 * 署名付き URL token で service image を保存する OpenAPI 定義です。
 */
export const uploadServiceImageBySignedUrlRoute = createRoute({
  method: 'put',
  path: '/services/images/upload/{token}',
  tags: ['Services'],
  summary: 'Upload service image using signed URL',
  request: { params: serviceImageUploadTokenParamSchema },
  responses: {
    201: { description: 'Service image uploaded' },
    400: { description: 'Validation error' },
    401: { description: 'Invalid or expired upload token' },
    413: { description: 'File too large' },
    503: { description: 'Service image upload not configured' },
  },
});

/**
 * 保存済み service image を object key で配信する OpenAPI 定義です。
 */
export const getServiceImageRoute = createRoute({
  method: 'get',
  path: '/services/images/{key}',
  tags: ['Services'],
  summary: 'Get service image by key',
  request: { params: serviceImageKeyParamSchema },
  responses: {
    200: { description: 'Service image object' },
    400: { description: 'Invalid key' },
    404: { description: 'Not found' },
    503: { description: 'Service image delivery is not configured' },
  },
});

/**
 * service を部分更新する OpenAPI 定義です。
 */
export const updateServiceRoute = createRoute({
  method: 'post',
  path: scopedStoreAuthPath('/services/update'),
  tags: ['Services'],
  summary: 'Update service',
  request: {
    params: scopedStoreRouteParamsSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: serviceUpdateBodySchema } },
    },
  },
  responses: {
    200: { description: 'Service updated' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    422: { description: 'Validation error' },
  },
});

/**
 * service を非 active にする OpenAPI 定義です。
 */
export const archiveServiceRoute = createRoute({
  method: 'post',
  path: scopedStoreAuthPath('/services/archive'),
  tags: ['Services'],
  summary: 'Archive service',
  request: {
    params: scopedStoreRouteParamsSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: serviceArchiveBodySchema } },
    },
  },
  responses: {
    200: { description: 'Service archived' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
});
