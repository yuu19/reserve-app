import { createRoute, z } from '@hono/zod-openapi';

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO datetime');

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)');

const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid local time (HH:mm)');

const boolStringSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

/**
 * recurring schedule 作成 API の入力を検証します。
 */
export const recurringCreateBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  serviceId: z.string().min(1),
  timezone: z.string().optional(),
  frequency: z.enum(['weekly', 'monthly']),
  interval: z.int().min(1).max(52),
  byWeekday: z.array(z.int().min(1).max(7)).optional(),
  byMonthday: z.int().min(1).max(31).optional(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.optional(),
  startTimeLocal: localTimeSchema,
  durationMinutes: z
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
  capacityOverride: z.int().min(1).max(500).optional(),
});

/**
 * recurring schedule 一覧 API の query を検証します。
 */
export const recurringListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  isActive: boolStringSchema,
});

/**
 * recurring schedule 更新 API の入力を、部分更新として検証します。
 */
export const recurringUpdateBodySchema = z.object({
  recurringScheduleId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
  timezone: z.string().optional(),
  frequency: z.enum(['weekly', 'monthly']).optional(),
  interval: z.int().min(1).max(52).optional(),
  byWeekday: z.array(z.int().min(1).max(7)).optional(),
  byMonthday: z.int().min(1).max(31).optional(),
  startDate: dateOnlySchema.optional(),
  endDate: dateOnlySchema.optional(),
  startTimeLocal: localTimeSchema.optional(),
  durationMinutes: z
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
  capacityOverride: z.int().min(1).max(500).optional(),
  isActive: z.boolean().optional(),
});

/**
 * 特定日を skip または override する recurring exception 入力を検証します。
 */
export const recurringExceptionBodySchema = z.object({
  recurringScheduleId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
  date: dateOnlySchema,
  action: z.enum(['skip', 'override']),
  overrideStartTimeLocal: localTimeSchema.optional(),
  overrideDurationMinutes: z
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
  overrideCapacity: z.int().min(1).max(500).optional(),
});

/**
 * recurring slot の手動生成範囲を検証します。
 */
export const recurringGenerateBodySchema = z.object({
  recurringScheduleId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

/**
 * recurring schedule 作成 usecase が受け取る検証済み body 型です。
 */
export type RecurringCreateBody = z.infer<typeof recurringCreateBodySchema>;
/**
 * recurring schedule 一覧 usecase が受け取る検証済み query 型です。
 */
export type RecurringListQuery = z.infer<typeof recurringListQuerySchema>;
/**
 * recurring schedule 更新 usecase が受け取る検証済み body 型です。
 */
export type RecurringUpdateBody = z.infer<typeof recurringUpdateBodySchema>;
/**
 * recurring exception upsert usecase が受け取る検証済み body 型です。
 */
export type RecurringExceptionBody = z.infer<typeof recurringExceptionBodySchema>;
/**
 * recurring slot 手動生成 usecase が受け取る検証済み body 型です。
 */
export type RecurringGenerateBody = z.infer<typeof recurringGenerateBodySchema>;

/**
 * recurring schedule を作成し、既定期間の slot を同期生成する OpenAPI 定義です。
 */
export const createRecurringScheduleRoute = createRoute({
  method: 'post',
  path: '/organizations/recurring-schedules',
  tags: ['Recurring Schedules'],
  summary: 'Create recurring schedule',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: recurringCreateBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Recurring schedule created' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    422: { description: 'Validation error' },
  },
});

/**
 * staff が管理対象 recurring schedule を取得する OpenAPI 定義です。
 */
export const listRecurringSchedulesRoute = createRoute({
  method: 'get',
  path: '/organizations/recurring-schedules',
  tags: ['Recurring Schedules'],
  summary: 'List recurring schedules',
  request: {
    query: recurringListQuerySchema,
  },
  responses: {
    200: { description: 'Recurring schedule list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

/**
 * recurring schedule を更新し、既定期間の slot を再同期する OpenAPI 定義です。
 */
export const updateRecurringScheduleRoute = createRoute({
  method: 'post',
  path: '/organizations/recurring-schedules/update',
  tags: ['Recurring Schedules'],
  summary: 'Update recurring schedule',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: recurringUpdateBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Recurring schedule updated' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    422: { description: 'Validation error' },
  },
});

/**
 * recurring schedule の特定日例外を作成または更新する OpenAPI 定義です。
 */
export const upsertRecurringExceptionRoute = createRoute({
  method: 'post',
  path: '/organizations/recurring-schedules/exceptions',
  tags: ['Recurring Schedules'],
  summary: 'Create or update recurring schedule exception',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: recurringExceptionBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Recurring schedule exception updated' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    422: { description: 'Validation error' },
  },
});

/**
 * recurring schedule から指定期間の slot を手動生成する OpenAPI 定義です。
 */
export const generateRecurringSlotsRoute = createRoute({
  method: 'post',
  path: '/organizations/recurring-schedules/generate',
  tags: ['Recurring Schedules'],
  summary: 'Generate recurring slots manually',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: recurringGenerateBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Recurring slots generated' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    422: { description: 'Validation error' },
  },
});
