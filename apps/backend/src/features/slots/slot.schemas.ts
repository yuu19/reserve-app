import { createRoute, z } from '@hono/zod-openapi';
import { SLOT_STATUS } from '../../domain/booking/constants.js';

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO datetime');

const slotStatusSchema = z.enum([SLOT_STATUS.OPEN, SLOT_STATUS.CANCELED, SLOT_STATUS.COMPLETED]);

/**
 * slot 作成 API の入力を検証します。
 */
export const slotCreateBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
  serviceId: z.string().min(1),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  capacity: z.int().min(1).max(500).optional(),
  staffLabel: z.string().trim().max(120).optional(),
  locationLabel: z.string().trim().max(120).optional(),
});

/**
 * 予約のない open slot を更新する入力を検証します。
 */
export const slotUpdateBodySchema = z.object({
  slotId: z.string().min(1),
  storeId: z.string().min(1).optional(),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  capacity: z.int().min(1).max(500).optional(),
  staffLabel: z.string().trim().max(120).optional(),
  locationLabel: z.string().trim().max(120).optional(),
});

/**
 * staff 向け slot 一覧 API の query を検証します。
 */
export const slotListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
  status: slotStatusSchema.optional(),
});

/**
 * participant 向け空き slot 一覧 API の query を検証します。
 */
export const slotAvailableQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
});

/**
 * slot キャンセル API の入力を検証します。
 */
export const slotCancelBodySchema = z.object({
  slotId: z.string().min(1),
  storeId: z.string().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * slot 作成 usecase が受け取る検証済み body 型です。
 */
export type SlotCreateBody = z.infer<typeof slotCreateBodySchema>;
/**
 * slot 更新 usecase が受け取る検証済み body 型です。
 */
export type SlotUpdateBody = z.infer<typeof slotUpdateBodySchema>;
/**
 * staff 向け slot 一覧 usecase が受け取る検証済み query 型です。
 */
export type SlotListQuery = z.infer<typeof slotListQuerySchema>;
/**
 * participant 向け空き slot 一覧 usecase が受け取る検証済み query 型です。
 */
export type SlotAvailableQuery = z.infer<typeof slotAvailableQuerySchema>;
/**
 * slot キャンセル usecase が受け取る検証済み body 型です。
 */
export type SlotCancelBody = z.infer<typeof slotCancelBodySchema>;

/**
 * service に紐づく単発 slot を作成する OpenAPI 定義です。
 */
export const createSlotRoute = createRoute({
  method: 'post',
  path: '/organizations/slots',
  tags: ['Slots'],
  summary: 'Create slot',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: slotCreateBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Slot created' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    422: { description: 'Validation error' },
  },
});

/**
 * 予約前の open slot を更新する OpenAPI 定義です。
 */
export const updateSlotRoute = createRoute({
  method: 'post',
  path: '/organizations/slots/update',
  tags: ['Slots'],
  summary: 'Update slot',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: slotUpdateBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Slot updated' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
    422: { description: 'Validation error' },
  },
});

/**
 * staff が管理対象 slot を期間指定で取得する OpenAPI 定義です。
 */
export const listSlotsRoute = createRoute({
  method: 'get',
  path: '/organizations/slots',
  tags: ['Slots'],
  summary: 'List slots for staff',
  request: {
    query: slotListQuerySchema,
  },
  responses: {
    200: { description: 'Slot list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

/**
 * participant が予約可能な slot だけを取得する OpenAPI 定義です。
 */
export const listAvailableSlotsRoute = createRoute({
  method: 'get',
  path: '/organizations/slots/available',
  tags: ['Slots'],
  summary: 'List available slots for participant',
  request: {
    query: slotAvailableQuerySchema,
  },
  responses: {
    200: { description: 'Available slot list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

/**
 * open slot をキャンセルし、確定予約も staff キャンセルへ遷移させる OpenAPI 定義です。
 */
export const cancelSlotRoute = createRoute({
  method: 'post',
  path: '/organizations/slots/cancel',
  tags: ['Slots'],
  summary: 'Cancel slot',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: slotCancelBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Slot canceled' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});
