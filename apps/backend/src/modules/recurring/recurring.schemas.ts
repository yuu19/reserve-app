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

export const recurringListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  isActive: boolStringSchema,
});

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

export const recurringGenerateBodySchema = z.object({
  recurringScheduleId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

export type RecurringCreateBody = z.infer<typeof recurringCreateBodySchema>;
export type RecurringListQuery = z.infer<typeof recurringListQuerySchema>;
export type RecurringUpdateBody = z.infer<typeof recurringUpdateBodySchema>;
export type RecurringExceptionBody = z.infer<typeof recurringExceptionBodySchema>;
export type RecurringGenerateBody = z.infer<typeof recurringGenerateBodySchema>;

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
