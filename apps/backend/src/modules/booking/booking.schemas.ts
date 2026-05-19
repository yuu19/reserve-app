import { createRoute, z } from '@hono/zod-openapi';
import { BOOKING_STATUS } from '../../booking/constants.js';

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO datetime');

const bookingStatusSchema = z.enum([
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.PENDING_APPROVAL,
  BOOKING_STATUS.CANCELED_BY_PARTICIPANT,
  BOOKING_STATUS.CANCELED_BY_STAFF,
  BOOKING_STATUS.REJECTED_BY_STAFF,
  BOOKING_STATUS.NO_SHOW,
]);

export const bookingCreateBodySchema = z.object({
  slotId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
  participantsCount: z.int().min(1).max(20).optional(),
});

export const bookingMineQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  status: bookingStatusSchema.optional(),
});

export const bookingListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  participantId: z.string().min(1).optional(),
  status: bookingStatusSchema.optional(),
});

export const bookingActionBodySchema = z.object({
  bookingId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
});

export const bookingNoShowBodySchema = z.object({
  bookingId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
});

export const bookingApproveBodySchema = z.object({
  bookingId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
});

export type BookingCreateBody = z.infer<typeof bookingCreateBodySchema>;
export type BookingMineQuery = z.infer<typeof bookingMineQuerySchema>;
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;
export type BookingActionBody = z.infer<typeof bookingActionBodySchema>;
export type BookingNoShowBody = z.infer<typeof bookingNoShowBodySchema>;
export type BookingApproveBody = z.infer<typeof bookingApproveBodySchema>;

export const createBookingRoute = createRoute({
  method: 'post',
  path: '/organizations/bookings',
  tags: ['Bookings'],
  summary: 'Create booking',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: bookingCreateBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Booking created' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});

export const listMyBookingsRoute = createRoute({
  method: 'get',
  path: '/organizations/bookings/mine',
  tags: ['Bookings'],
  summary: 'List my bookings',
  request: {
    query: bookingMineQuerySchema,
  },
  responses: {
    200: { description: 'Booking list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

export const cancelBookingRoute = createRoute({
  method: 'post',
  path: '/organizations/bookings/cancel',
  tags: ['Bookings'],
  summary: 'Cancel booking by participant',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: bookingActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Booking canceled' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});

export const listBookingsRoute = createRoute({
  method: 'get',
  path: '/organizations/bookings',
  tags: ['Bookings'],
  summary: 'List bookings for staff',
  request: {
    query: bookingListQuerySchema,
  },
  responses: {
    200: { description: 'Booking list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

export const cancelBookingByStaffRoute = createRoute({
  method: 'post',
  path: '/organizations/bookings/cancel-by-staff',
  tags: ['Bookings'],
  summary: 'Cancel booking by staff',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: bookingActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Booking canceled' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});

export const approveBookingByStaffRoute = createRoute({
  method: 'post',
  path: '/organizations/bookings/approve',
  tags: ['Bookings'],
  summary: 'Approve booking by staff',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: bookingApproveBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Booking approved' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});

export const rejectBookingByStaffRoute = createRoute({
  method: 'post',
  path: '/organizations/bookings/reject',
  tags: ['Bookings'],
  summary: 'Reject booking by staff',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: bookingActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Booking rejected' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});

export const markNoShowRoute = createRoute({
  method: 'post',
  path: '/organizations/bookings/no-show',
  tags: ['Bookings'],
  summary: 'Mark booking as no show',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: bookingNoShowBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Booking marked as no-show' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});
