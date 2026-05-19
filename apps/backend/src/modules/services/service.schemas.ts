import { createRoute, z } from '@hono/zod-openapi';

const boolStringSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

const serviceKindSchema = z.enum(['single', 'recurring']);
const bookingPolicySchema = z.enum(['instant', 'approval']);

export const serviceCreateBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
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
  imageUrl: z.string().trim().max(2048).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const serviceListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  includeArchived: boolStringSchema,
});

export const serviceUpdateBodySchema = z.object({
  serviceId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
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
  imageUrl: z.string().trim().max(2048).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const serviceImageUploadUrlBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  fileName: z.string().trim().min(1).max(255).optional(),
  contentType: z.string().trim().min(1).max(120),
  size: z.int().min(1),
});

export const serviceImageUploadTokenParamSchema = z.object({
  token: z.string().trim().min(20).max(4096),
});

export const serviceImageKeyParamSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]+$/)
    .min(1)
    .max(255),
});

export const serviceArchiveBodySchema = z.object({
  serviceId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
});

export type ServiceCreateBody = z.infer<typeof serviceCreateBodySchema>;
export type ServiceListQuery = z.infer<typeof serviceListQuerySchema>;
export type ServiceUpdateBody = z.infer<typeof serviceUpdateBodySchema>;
export type ServiceArchiveBody = z.infer<typeof serviceArchiveBodySchema>;
export type ServiceImageUploadUrlBody = z.infer<typeof serviceImageUploadUrlBodySchema>;

export const createServiceRoute = createRoute({
  method: 'post',
  path: '/organizations/services',
  tags: ['Services'],
  summary: 'Create service',
  request: {
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

export const listServicesRoute = createRoute({
  method: 'get',
  path: '/organizations/services',
  tags: ['Services'],
  summary: 'List services',
  request: { query: serviceListQuerySchema },
  responses: {
    200: { description: 'Service list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

export const createServiceImageUploadUrlRoute = createRoute({
  method: 'post',
  path: '/organizations/services/images/upload-url',
  tags: ['Services'],
  summary: 'Create signed upload URL for service image',
  request: {
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

export const uploadServiceImageBySignedUrlRoute = createRoute({
  method: 'put',
  path: '/organizations/services/images/upload/{token}',
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

export const getServiceImageRoute = createRoute({
  method: 'get',
  path: '/organizations/services/images/{key}',
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

export const updateServiceRoute = createRoute({
  method: 'post',
  path: '/organizations/services/update',
  tags: ['Services'],
  summary: 'Update service',
  request: {
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

export const archiveServiceRoute = createRoute({
  method: 'post',
  path: '/organizations/services/archive',
  tags: ['Services'],
  summary: 'Archive service',
  request: {
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
