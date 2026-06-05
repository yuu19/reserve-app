import { createRoute, z } from '@hono/zod-openapi';
import { SLOT_PUBLIC_STATUS, SLOT_STATUS } from '../../domain/booking/constants.js';
import {
  scopedStoreAuthPath,
  scopedStoreRouteParamsSchema,
} from '../../shared/scoped-store-route.js';

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO datetime');

const slotStatusSchema = z.enum([SLOT_STATUS.OPEN, SLOT_STATUS.CANCELED, SLOT_STATUS.COMPLETED]);
const slotPublicStatusSchema = z.enum([
  SLOT_PUBLIC_STATUS.PUBLIC,
  SLOT_PUBLIC_STATUS.PRIVATE,
  SLOT_PUBLIC_STATUS.SUSPENDED,
]);

/**
 * slot 作成 API の入力を検証します。
 */
export const slotCreateBodySchema = z.object({
  serviceId: z.string().min(1),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  capacity: z.int().min(1).max(500).optional(),
  staffLabel: z.string().trim().max(120).optional(),
  locationLabel: z.string().trim().max(120).optional(),
  publicStatus: slotPublicStatusSchema.optional(),
});

/**
 * 予約のない open slot を更新する入力を検証します。
 */
export const slotUpdateBodySchema = z.object({
  slotId: z.string().min(1),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  capacity: z.int().min(1).max(500).optional(),
  staffLabel: z.string().trim().max(120).optional(),
  locationLabel: z.string().trim().max(120).optional(),
});

/**
 * slot の公開予約上の表示だけを更新する入力を検証します。
 */
export const slotPublicStatusUpdateBodySchema = z.object({
  slotId: z.string().min(1),
  publicStatus: slotPublicStatusSchema,
});

/**
 * staff 向け slot 一覧 API の query を検証します。
 */
export const slotListQuerySchema = z.object({
  serviceId: z.string().min(1).optional(),
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
  status: slotStatusSchema.optional(),
});

/**
 * participant 向け空き slot 一覧 API の query を検証します。
 */
export const slotAvailableQuerySchema = z.object({
  serviceId: z.string().min(1).optional(),
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
});

/**
 * slot キャンセル API の入力を検証します。
 */
export const slotCancelBodySchema = z.object({
  slotId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

type ScopedStoreInput = {
  organizationId: string;
  storeId: string;
};

/**
 * slot 作成 usecase が受け取る検証済み body 型です。
 */
export type SlotCreateBody = z.infer<typeof slotCreateBodySchema> & ScopedStoreInput;
/**
 * slot 更新 usecase が受け取る検証済み body 型です。
 */
export type SlotUpdateBody = z.infer<typeof slotUpdateBodySchema> & ScopedStoreInput;
/**
 * slot 公開状態更新 usecase が受け取る検証済み body 型です。
 */
export type SlotPublicStatusUpdateBody = z.infer<typeof slotPublicStatusUpdateBodySchema> &
  ScopedStoreInput;
/**
 * staff 向け slot 一覧 usecase が受け取る検証済み query 型です。
 */
export type SlotListQuery = z.infer<typeof slotListQuerySchema> & ScopedStoreInput;
/**
 * participant 向け空き slot 一覧 usecase が受け取る検証済み query 型です。
 */
export type SlotAvailableQuery = z.infer<typeof slotAvailableQuerySchema> & ScopedStoreInput;
/**
 * slot キャンセル usecase が受け取る検証済み body 型です。
 */
export type SlotCancelBody = z.infer<typeof slotCancelBodySchema> & ScopedStoreInput;

/**
 * service に紐づく単発 slot を作成する OpenAPI 定義です。
 */
export const createSlotRoute = createRoute({
  method: 'post',
  path: scopedStoreAuthPath('/slots'),
  tags: ['Slots'],
  summary: 'Create slot',
  request: {
    params: scopedStoreRouteParamsSchema,
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
  path: scopedStoreAuthPath('/slots/update'),
  tags: ['Slots'],
  summary: 'Update slot',
  request: {
    params: scopedStoreRouteParamsSchema,
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
 * open slot の公開予約上の表示を更新する OpenAPI 定義です。
 */
export const updateSlotPublicStatusRoute = createRoute({
  method: 'post',
  path: scopedStoreAuthPath('/slots/public-status'),
  tags: ['Slots'],
  summary: 'Update slot public status',
  request: {
    params: scopedStoreRouteParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: slotPublicStatusUpdateBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Slot public status updated' },
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
  path: scopedStoreAuthPath('/slots'),
  tags: ['Slots'],
  summary: 'List slots for staff',
  request: {
    params: scopedStoreRouteParamsSchema,
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
  path: scopedStoreAuthPath('/slots/available'),
  tags: ['Slots'],
  summary: 'List available slots for participant',
  request: {
    params: scopedStoreRouteParamsSchema,
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
  path: scopedStoreAuthPath('/slots/cancel'),
  tags: ['Slots'],
  summary: 'Cancel slot',
  request: {
    params: scopedStoreRouteParamsSchema,
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
