import { createRoute, z } from '@hono/zod-openapi';
import { SLOT_STATUS } from '../../booking/constants.js';

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO datetime');

const slotStatusSchema = z.enum([SLOT_STATUS.OPEN, SLOT_STATUS.CANCELED, SLOT_STATUS.COMPLETED]);

export const slotCreateBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  serviceId: z.string().min(1),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  capacity: z.int().min(1).max(500).optional(),
  staffLabel: z.string().trim().max(120).optional(),
  locationLabel: z.string().trim().max(120).optional(),
});

export const slotUpdateBodySchema = z.object({
  slotId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  capacity: z.int().min(1).max(500).optional(),
  staffLabel: z.string().trim().max(120).optional(),
  locationLabel: z.string().trim().max(120).optional(),
});

export const slotListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
  status: slotStatusSchema.optional(),
});

export const slotAvailableQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
});

export const slotCancelBodySchema = z.object({
  slotId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
});

export type SlotCreateBody = z.infer<typeof slotCreateBodySchema>;
export type SlotUpdateBody = z.infer<typeof slotUpdateBodySchema>;
export type SlotListQuery = z.infer<typeof slotListQuerySchema>;
export type SlotAvailableQuery = z.infer<typeof slotAvailableQuerySchema>;
export type SlotCancelBody = z.infer<typeof slotCancelBodySchema>;

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
