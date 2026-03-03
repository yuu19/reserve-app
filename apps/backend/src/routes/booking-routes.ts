import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import {
  findParticipantByUserAndOrganization,
  getSessionIdentity,
  hasAdminOrOwnerAccess,
  resolveOrganizationId,
} from '../booking/authorization.js';
import { writeBookingAuditLog } from '../booking/audit.js';
import {
  BOOKING_STATUS,
  DEFAULT_CANCELLATION_DEADLINE_MINUTES,
  DEFAULT_TIMEZONE,
  SLOT_STATUS,
  TICKET_LEDGER_ACTION,
  TICKET_PACK_STATUS,
  TICKET_PURCHASE_METHOD,
  TICKET_PURCHASE_STATUS,
} from '../booking/constants.js';
import {
  defaultRecurringRange,
  isSupportedTimezone,
  syncRecurringScheduleSlots,
} from '../booking/recurring.js';
import * as dbSchema from '../db/schema.js';
import {
  sendBookingNotificationEmail,
  type BookingNotificationEvent,
} from '../email/resend.js';
import { createCheckoutSession } from '../payment/stripe.js';
import {
  ServiceImageUploadError,
  type ServiceImageUploadService,
} from '../service-image-upload-service.js';

type AuthRouteBindings = {
  Variables: {
    user: Record<string, unknown> | null;
    session: Record<string, unknown> | null;
  };
};

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO datetime');

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)');

const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid local time (HH:mm)');

const serviceKindSchema = z.enum(['single', 'recurring']);
const bookingPolicySchema = z.enum(['instant', 'approval']);
const slotStatusSchema = z.enum([SLOT_STATUS.OPEN, SLOT_STATUS.CANCELED, SLOT_STATUS.COMPLETED]);
const bookingStatusSchema = z.enum([
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.PENDING_APPROVAL,
  BOOKING_STATUS.CANCELED_BY_PARTICIPANT,
  BOOKING_STATUS.CANCELED_BY_STAFF,
  BOOKING_STATUS.REJECTED_BY_STAFF,
  BOOKING_STATUS.NO_SHOW,
]);

const boolStringSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

const orgQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

const serviceCreateBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  kind: serviceKindSchema,
  durationMinutes: z.int().min(1).max(24 * 60),
  capacity: z.int().min(1).max(500),
  bookingOpenMinutesBefore: z.int().min(0).max(365 * 24 * 60).optional(),
  bookingCloseMinutesBefore: z.int().min(0).max(365 * 24 * 60).optional(),
  cancellationDeadlineMinutes: z.int().min(0).max(365 * 24 * 60).optional(),
  timezone: z.string().optional(),
  bookingPolicy: bookingPolicySchema.optional(),
  requiresTicket: z.boolean().optional(),
  imageUrl: z.string().trim().max(2048).nullable().optional(),
  isActive: z.boolean().optional(),
});

const serviceListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  includeArchived: boolStringSchema,
});

const serviceUpdateBodySchema = z.object({
  serviceId: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  kind: serviceKindSchema.optional(),
  durationMinutes: z.int().min(1).max(24 * 60).optional(),
  capacity: z.int().min(1).max(500).optional(),
  bookingOpenMinutesBefore: z.int().min(0).max(365 * 24 * 60).optional(),
  bookingCloseMinutesBefore: z.int().min(0).max(365 * 24 * 60).optional(),
  cancellationDeadlineMinutes: z.int().min(0).max(365 * 24 * 60).optional(),
  timezone: z.string().optional(),
  bookingPolicy: bookingPolicySchema.optional(),
  requiresTicket: z.boolean().optional(),
  imageUrl: z.string().trim().max(2048).nullable().optional(),
  isActive: z.boolean().optional(),
});

const serviceImageUploadUrlBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  fileName: z.string().trim().min(1).max(255).optional(),
  contentType: z.string().trim().min(1).max(120),
  size: z.int().min(1),
});

const serviceImageUploadTokenParamSchema = z.object({
  token: z.string().trim().min(20).max(4096),
});

const serviceArchiveBodySchema = z.object({
  serviceId: z.string().min(1),
});

const slotCreateBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  serviceId: z.string().min(1),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  capacity: z.int().min(1).max(500).optional(),
  staffLabel: z.string().trim().max(120).optional(),
  locationLabel: z.string().trim().max(120).optional(),
});

const slotListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
  status: slotStatusSchema.optional(),
});

const slotAvailableQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
});

const slotCancelBodySchema = z.object({
  slotId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

const recurringCreateBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  serviceId: z.string().min(1),
  timezone: z.string().optional(),
  frequency: z.enum(['weekly', 'monthly']),
  interval: z.int().min(1).max(52),
  byWeekday: z.array(z.int().min(1).max(7)).optional(),
  byMonthday: z.int().min(1).max(31).optional(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.optional(),
  startTimeLocal: localTimeSchema,
  durationMinutes: z.int().min(1).max(24 * 60).optional(),
  capacityOverride: z.int().min(1).max(500).optional(),
});

const recurringListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  isActive: boolStringSchema,
});

const recurringUpdateBodySchema = z.object({
  recurringScheduleId: z.string().min(1),
  timezone: z.string().optional(),
  frequency: z.enum(['weekly', 'monthly']).optional(),
  interval: z.int().min(1).max(52).optional(),
  byWeekday: z.array(z.int().min(1).max(7)).optional(),
  byMonthday: z.int().min(1).max(31).optional(),
  startDate: dateOnlySchema.optional(),
  endDate: dateOnlySchema.optional(),
  startTimeLocal: localTimeSchema.optional(),
  durationMinutes: z.int().min(1).max(24 * 60).optional(),
  capacityOverride: z.int().min(1).max(500).optional(),
  isActive: z.boolean().optional(),
});

const recurringExceptionBodySchema = z.object({
  recurringScheduleId: z.string().min(1),
  date: dateOnlySchema,
  action: z.enum(['skip', 'override']),
  overrideStartTimeLocal: localTimeSchema.optional(),
  overrideDurationMinutes: z.int().min(1).max(24 * 60).optional(),
  overrideCapacity: z.int().min(1).max(500).optional(),
});

const recurringGenerateBodySchema = z.object({
  recurringScheduleId: z.string().min(1),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

const bookingCreateBodySchema = z.object({
  slotId: z.string().min(1),
  participantsCount: z.int().min(1).max(20).optional(),
});

const bookingMineQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  status: bookingStatusSchema.optional(),
});

const bookingListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  participantId: z.string().min(1).optional(),
  status: bookingStatusSchema.optional(),
});

const bookingActionBodySchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

const bookingNoShowBodySchema = z.object({
  bookingId: z.string().min(1),
});

const bookingApproveBodySchema = z.object({
  bookingId: z.string().min(1),
});

const ticketTypeCreateBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  serviceIds: z.array(z.string().min(1)).optional(),
  totalCount: z.int().min(1).max(1000),
  expiresInDays: z.int().min(1).max(3650).optional(),
  isActive: z.boolean().optional(),
  isForSale: z.boolean().optional(),
  stripePriceId: z.string().trim().min(1).max(200).optional(),
});

const ticketTypeListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  isActive: boolStringSchema,
});

const ticketPackGrantBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  participantId: z.string().min(1),
  ticketTypeId: z.string().min(1),
  count: z.int().min(1).max(1000).optional(),
  expiresAt: isoDateTimeSchema.optional(),
});

const ticketPackMineQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

const ticketPurchaseMethodSchema = z.enum([
  TICKET_PURCHASE_METHOD.STRIPE,
  TICKET_PURCHASE_METHOD.CASH_ON_SITE,
  TICKET_PURCHASE_METHOD.BANK_TRANSFER,
]);

const ticketPurchaseStatusSchema = z.enum([
  TICKET_PURCHASE_STATUS.PENDING_PAYMENT,
  TICKET_PURCHASE_STATUS.PENDING_APPROVAL,
  TICKET_PURCHASE_STATUS.APPROVED,
  TICKET_PURCHASE_STATUS.REJECTED,
  TICKET_PURCHASE_STATUS.CANCELLED_BY_PARTICIPANT,
]);

const ticketPurchaseCreateBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  ticketTypeId: z.string().min(1),
  paymentMethod: ticketPurchaseMethodSchema,
});

const ticketPurchaseMineQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  status: ticketPurchaseStatusSchema.optional(),
});

const ticketPurchaseListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  participantId: z.string().min(1).optional(),
  paymentMethod: ticketPurchaseMethodSchema.optional(),
  status: ticketPurchaseStatusSchema.optional(),
});

const ticketPurchaseApproveBodySchema = z.object({
  purchaseId: z.string().min(1),
});

const ticketPurchaseRejectBodySchema = z.object({
  purchaseId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

const ticketPurchaseCancelBodySchema = z.object({
  purchaseId: z.string().min(1),
});

const createServiceRoute = createRoute({
  method: 'post',
  path: '/organizations/services',
  tags: ['Services'],
  summary: 'Create service',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: serviceCreateBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Service created' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    422: { description: 'Validation error' },
  },
});

const listServicesRoute = createRoute({
  method: 'get',
  path: '/organizations/services',
  tags: ['Services'],
  summary: 'List services',
  request: {
    query: serviceListQuerySchema,
  },
  responses: {
    200: { description: 'Service list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

const serviceImageKeyParamSchema = z.object({
  key: z.string().trim().regex(/^[a-zA-Z0-9._-]+$/).min(1).max(255),
});

const createServiceImageUploadUrlRoute = createRoute({
  method: 'post',
  path: '/organizations/services/images/upload-url',
  tags: ['Services'],
  summary: 'Create signed upload URL for service image',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: serviceImageUploadUrlBodySchema,
        },
      },
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

const uploadServiceImageBySignedUrlRoute = createRoute({
  method: 'put',
  path: '/organizations/services/images/upload/{token}',
  tags: ['Services'],
  summary: 'Upload service image using signed URL',
  request: {
    params: serviceImageUploadTokenParamSchema,
  },
  responses: {
    201: { description: 'Service image uploaded' },
    400: { description: 'Validation error' },
    401: { description: 'Invalid or expired upload token' },
    413: { description: 'File too large' },
    503: { description: 'Service image upload not configured' },
  },
});

const getServiceImageRoute = createRoute({
  method: 'get',
  path: '/organizations/services/images/{key}',
  tags: ['Services'],
  summary: 'Get service image by key',
  request: {
    params: serviceImageKeyParamSchema,
  },
  responses: {
    200: { description: 'Service image object' },
    400: { description: 'Invalid key' },
    404: { description: 'Not found' },
    503: { description: 'Service image delivery is not configured' },
  },
});

const updateServiceRoute = createRoute({
  method: 'post',
  path: '/organizations/services/update',
  tags: ['Services'],
  summary: 'Update service',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: serviceUpdateBodySchema,
        },
      },
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

const archiveServiceRoute = createRoute({
  method: 'post',
  path: '/organizations/services/archive',
  tags: ['Services'],
  summary: 'Archive service',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: serviceArchiveBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Service archived' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
});

const createSlotRoute = createRoute({
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

const listSlotsRoute = createRoute({
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

const listAvailableSlotsRoute = createRoute({
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

const cancelSlotRoute = createRoute({
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

const createRecurringScheduleRoute = createRoute({
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

const listRecurringSchedulesRoute = createRoute({
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

const updateRecurringScheduleRoute = createRoute({
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

const upsertRecurringExceptionRoute = createRoute({
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

const generateRecurringSlotsRoute = createRoute({
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

const createBookingRoute = createRoute({
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

const listMyBookingsRoute = createRoute({
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

const cancelBookingRoute = createRoute({
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

const listBookingsRoute = createRoute({
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

const cancelBookingByStaffRoute = createRoute({
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

const approveBookingByStaffRoute = createRoute({
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

const rejectBookingByStaffRoute = createRoute({
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

const markNoShowRoute = createRoute({
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

const createTicketTypeRoute = createRoute({
  method: 'post',
  path: '/organizations/ticket-types',
  tags: ['Tickets'],
  summary: 'Create ticket type',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ticketTypeCreateBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Ticket type created' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    422: { description: 'Validation error' },
  },
});

const listTicketTypesRoute = createRoute({
  method: 'get',
  path: '/organizations/ticket-types',
  tags: ['Tickets'],
  summary: 'List ticket types',
  request: {
    query: ticketTypeListQuerySchema,
  },
  responses: {
    200: { description: 'Ticket type list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

const grantTicketPackRoute = createRoute({
  method: 'post',
  path: '/organizations/ticket-packs/grant',
  tags: ['Tickets'],
  summary: 'Grant ticket pack',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ticketPackGrantBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Ticket pack granted' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    422: { description: 'Validation error' },
  },
});

const listMyTicketPacksRoute = createRoute({
  method: 'get',
  path: '/organizations/ticket-packs/mine',
  tags: ['Tickets'],
  summary: 'List my ticket packs',
  request: {
    query: ticketPackMineQuerySchema,
  },
  responses: {
    200: { description: 'Ticket pack list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

const listPurchasableTicketTypesRoute = createRoute({
  method: 'get',
  path: '/organizations/ticket-types/purchasable',
  tags: ['Tickets'],
  summary: 'List purchasable ticket types',
  request: {
    query: orgQuerySchema,
  },
  responses: {
    200: { description: 'Purchasable ticket type list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

const createTicketPurchaseRoute = createRoute({
  method: 'post',
  path: '/organizations/ticket-purchases',
  tags: ['Tickets'],
  summary: 'Create ticket purchase',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ticketPurchaseCreateBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Ticket purchase created' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
    422: { description: 'Validation error' },
  },
});

const listMyTicketPurchasesRoute = createRoute({
  method: 'get',
  path: '/organizations/ticket-purchases/mine',
  tags: ['Tickets'],
  summary: 'List my ticket purchases',
  request: {
    query: ticketPurchaseMineQuerySchema,
  },
  responses: {
    200: { description: 'Ticket purchase list for participant' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

const listTicketPurchasesRoute = createRoute({
  method: 'get',
  path: '/organizations/ticket-purchases',
  tags: ['Tickets'],
  summary: 'List ticket purchases for staff',
  request: {
    query: ticketPurchaseListQuerySchema,
  },
  responses: {
    200: { description: 'Ticket purchase list for staff' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

const approveTicketPurchaseRoute = createRoute({
  method: 'post',
  path: '/organizations/ticket-purchases/approve',
  tags: ['Tickets'],
  summary: 'Approve ticket purchase',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ticketPurchaseApproveBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Ticket purchase approved' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});

const rejectTicketPurchaseRoute = createRoute({
  method: 'post',
  path: '/organizations/ticket-purchases/reject',
  tags: ['Tickets'],
  summary: 'Reject ticket purchase',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ticketPurchaseRejectBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Ticket purchase rejected' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});

const cancelTicketPurchaseRoute = createRoute({
  method: 'post',
  path: '/organizations/ticket-purchases/cancel',
  tags: ['Tickets'],
  summary: 'Cancel ticket purchase by participant',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ticketPurchaseCancelBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Ticket purchase canceled' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});

const parseIsoDateOrNull = (value: string | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoDate = (value: unknown): string | null => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
};

const isUniqueConstraintError = (error: unknown): boolean => {
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!(current instanceof Error)) {
      continue;
    }
    if (
      current.message.includes('UNIQUE constraint failed') ||
      current.message.includes('SQLITE_CONSTRAINT')
    ) {
      return true;
    }
    const nestedCause = (current as Error & { cause?: unknown }).cause;
    if (nestedCause) {
      queue.push(nestedCause);
    }
  }
  return false;
};

const assertSupportedTimezone = (timezone: string | undefined): string | null => {
  const resolved = timezone ?? DEFAULT_TIMEZONE;
  return isSupportedTimezone(resolved) ? resolved : null;
};

const parseDateParts = (value: string): { year: number; month: number; day: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  return { year, month, day };
};

const resolveEndDate = (ticketTypeExpiresInDays: number | null, explicitExpiresAt?: string): Date | null => {
  if (explicitExpiresAt) {
    const parsed = parseIsoDateOrNull(explicitExpiresAt);
    return parsed;
  }
  if (typeof ticketTypeExpiresInDays === 'number' && ticketTypeExpiresInDays > 0) {
    return new Date(Date.now() + ticketTypeExpiresInDays * 24 * 60 * 60 * 1000);
  }
  return null;
};

const normalizePackStatus = ({
  remainingCount,
  expiresAt,
}: {
  remainingCount: number;
  expiresAt: Date | null;
}): string => {
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return TICKET_PACK_STATUS.EXPIRED;
  }
  if (remainingCount <= 0) {
    return TICKET_PACK_STATUS.EXHAUSTED;
  }
  return TICKET_PACK_STATUS.ACTIVE;
};

const dateToComparable = (value: Date | null): number => {
  return value ? value.getTime() : Number.MAX_SAFE_INTEGER;
};

const resolveBookingPolicy = (value: string | null | undefined): 'instant' | 'approval' => {
  return value === 'approval' ? 'approval' : 'instant';
};

const normalizeServiceDescription = (
  value: string | null | undefined,
): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const registerBookingRoutes = ({
  authRoutes,
  auth,
  database,
  env,
  serviceImageUploadService,
}: {
  authRoutes: OpenAPIHono<AuthRouteBindings>;
  auth: AuthInstance;
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  serviceImageUploadService?: ServiceImageUploadService | null;
}) => {
  const requireIdentity = async (headers: Headers) => {
    return getSessionIdentity(auth, headers);
  };

  const formatDateTimeLabel = (value: Date, timezone: string) => {
    try {
      return new Intl.DateTimeFormat('ja-JP', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(value);
    } catch {
      return value.toISOString();
    }
  };

  const getBookingNotificationContext = async (bookingId: string) => {
    const rows = await database
      .select({
        bookingId: dbSchema.booking.id,
        organizationName: dbSchema.organization.name,
        participantEmail: dbSchema.participant.email,
        participantName: dbSchema.participant.name,
        serviceName: dbSchema.service.name,
        serviceTimezone: dbSchema.service.timezone,
        participantsCount: dbSchema.booking.participantsCount,
        slotStartAt: dbSchema.slot.startAt,
        slotEndAt: dbSchema.slot.endAt,
      })
      .from(dbSchema.booking)
      .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.booking.organizationId))
      .innerJoin(dbSchema.participant, eq(dbSchema.participant.id, dbSchema.booking.participantId))
      .innerJoin(dbSchema.service, eq(dbSchema.service.id, dbSchema.booking.serviceId))
      .innerJoin(dbSchema.slot, eq(dbSchema.slot.id, dbSchema.booking.slotId))
      .where(eq(dbSchema.booking.id, bookingId))
      .limit(1);

    return rows[0] ?? null;
  };

  const notifyBookingEmailBestEffort = async ({
    bookingId,
    event,
    reason,
  }: {
    bookingId: string;
    event: BookingNotificationEvent;
    reason?: string | null;
  }) => {
    try {
      const context = await getBookingNotificationContext(bookingId);
      if (!context) {
        console.warn(
          `[booking-email] Booking notification context not found. bookingId=${bookingId}`,
        );
        return;
      }

      const timezone = assertSupportedTimezone(context.serviceTimezone ?? undefined) ?? DEFAULT_TIMEZONE;
      await sendBookingNotificationEmail({
        env,
        inviteeEmail: context.participantEmail,
        organizationName: context.organizationName,
        participantName: context.participantName,
        serviceName: context.serviceName,
        participantsCount: context.participantsCount,
        slotStartLabel: formatDateTimeLabel(context.slotStartAt, timezone),
        slotEndLabel: formatDateTimeLabel(context.slotEndAt, timezone),
        event,
        reason,
        bookingId,
      });
    } catch (error) {
      console.warn(
        `[booking-email] Failed to send booking notification. bookingId=${bookingId}`,
        error,
      );
    }
  };

  const consumeTicketPackForParticipant = async ({
    organizationId,
    participantId,
    participantsCount,
    now,
  }: {
    organizationId: string;
    participantId: string;
    participantsCount: number;
    now: Date;
  }): Promise<{ ticketPackId: string; balanceAfter: number }> => {
    const ticketRows = await database
      .select({
        id: dbSchema.ticketPack.id,
        remainingCount: dbSchema.ticketPack.remainingCount,
        expiresAt: dbSchema.ticketPack.expiresAt,
        status: dbSchema.ticketPack.status,
        createdAt: dbSchema.ticketPack.createdAt,
      })
      .from(dbSchema.ticketPack)
      .where(
        and(
          eq(dbSchema.ticketPack.organizationId, organizationId),
          eq(dbSchema.ticketPack.participantId, participantId),
          eq(dbSchema.ticketPack.status, TICKET_PACK_STATUS.ACTIVE),
          gte(dbSchema.ticketPack.remainingCount, participantsCount),
        ),
      );

    const candidate = ticketRows
      .filter(
        (row: { expiresAt: Date | null }) =>
          !row.expiresAt || row.expiresAt.getTime() > now.getTime(),
      )
      .sort(
        (
          left: { expiresAt: Date | null; createdAt: Date },
          right: { expiresAt: Date | null; createdAt: Date },
        ) => {
          const exp = dateToComparable(left.expiresAt) - dateToComparable(right.expiresAt);
          if (exp !== 0) {
            return exp;
          }
          return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        },
      )
      .at(0);

    if (!candidate) {
      throw new Error('TICKET_REQUIRED');
    }

    const updatedPackRows = await database
      .update(dbSchema.ticketPack)
      .set({
        remainingCount: sql`${dbSchema.ticketPack.remainingCount} - ${participantsCount}`,
      })
      .where(
        and(
          eq(dbSchema.ticketPack.id, candidate.id),
          eq(dbSchema.ticketPack.status, TICKET_PACK_STATUS.ACTIVE),
          gte(dbSchema.ticketPack.remainingCount, participantsCount),
        ),
      )
      .returning({
        id: dbSchema.ticketPack.id,
        remainingCount: dbSchema.ticketPack.remainingCount,
        expiresAt: dbSchema.ticketPack.expiresAt,
      });

    const updatedPack = updatedPackRows[0];
    if (!updatedPack) {
      throw new Error('TICKET_CONFLICT');
    }

    const packStatus = normalizePackStatus({
      remainingCount: updatedPack.remainingCount,
      expiresAt: updatedPack.expiresAt,
    });
    await database
      .update(dbSchema.ticketPack)
      .set({
        status: packStatus,
      })
      .where(eq(dbSchema.ticketPack.id, updatedPack.id));

    return {
      ticketPackId: updatedPack.id,
      balanceAfter: updatedPack.remainingCount,
    };
  };

  const serializeTicketType = (row: Record<string, unknown> | undefined) => ({
    ...row,
    serviceIds:
      typeof row?.serviceIdsJson === 'string' && row.serviceIdsJson.length > 0
        ? JSON.parse(row.serviceIdsJson)
        : [],
    createdAt: toIsoDate(row?.createdAt),
    updatedAt: toIsoDate(row?.updatedAt),
  });

  const serializeTicketPack = (row: Record<string, unknown> | undefined) => ({
    ...row,
    expiresAt: toIsoDate(row?.expiresAt),
    createdAt: toIsoDate(row?.createdAt),
    updatedAt: toIsoDate(row?.updatedAt),
  });

  const serializeTicketPurchase = (row: Record<string, unknown> | undefined) => ({
    ...row,
    approvedAt: toIsoDate(row?.approvedAt),
    rejectedAt: toIsoDate(row?.rejectedAt),
    createdAt: toIsoDate(row?.createdAt),
    updatedAt: toIsoDate(row?.updatedAt),
  });

  const issueTicketPackWithLedger = async ({
    organizationId,
    participantId,
    ticketTypeId,
    count,
    expiresAt,
    actorUserId,
    reason,
    bookingId,
  }: {
    organizationId: string;
    participantId: string;
    ticketTypeId: string;
    count: number;
    expiresAt: Date | null;
    actorUserId: string;
    reason: string;
    bookingId?: string | null;
  }) => {
    const status = normalizePackStatus({
      remainingCount: count,
      expiresAt,
    });
    const ticketPackId = crypto.randomUUID();

    await database.insert(dbSchema.ticketPack).values({
      id: ticketPackId,
      organizationId,
      participantId,
      ticketTypeId,
      initialCount: count,
      remainingCount: count,
      expiresAt,
      status,
    });

    await database.insert(dbSchema.ticketLedger).values({
      id: crypto.randomUUID(),
      organizationId,
      ticketPackId,
      bookingId: bookingId ?? null,
      action: TICKET_LEDGER_ACTION.GRANT,
      delta: count,
      balanceAfter: count,
      actorUserId,
      reason,
    });

    const rows = await database
      .select()
      .from(dbSchema.ticketPack)
      .where(eq(dbSchema.ticketPack.id, ticketPackId))
      .limit(1);
    const ticketPack = rows[0];
    return {
      ticketPackId,
      ticketPack: serializeTicketPack(ticketPack as Record<string, unknown> | undefined),
    };
  };

  const approveTicketPurchaseWithIssue = async ({
    purchaseId,
    actorUserId,
    actorReason,
  }: {
    purchaseId: string;
    actorUserId: string;
    actorReason: string;
  }) => {
    const purchaseRows = await database
      .select({
        id: dbSchema.ticketPurchase.id,
        organizationId: dbSchema.ticketPurchase.organizationId,
        participantId: dbSchema.ticketPurchase.participantId,
        ticketTypeId: dbSchema.ticketPurchase.ticketTypeId,
        status: dbSchema.ticketPurchase.status,
        ticketPackId: dbSchema.ticketPurchase.ticketPackId,
      })
      .from(dbSchema.ticketPurchase)
      .where(eq(dbSchema.ticketPurchase.id, purchaseId))
      .limit(1);
    const purchase = purchaseRows[0];
    if (!purchase) {
      return { kind: 'not_found' as const };
    }

    if (purchase.status === TICKET_PURCHASE_STATUS.APPROVED && purchase.ticketPackId) {
      const rows = await database
        .select()
        .from(dbSchema.ticketPurchase)
        .where(eq(dbSchema.ticketPurchase.id, purchaseId))
        .limit(1);
      return {
        kind: 'already_approved' as const,
        purchase: serializeTicketPurchase(rows[0] as Record<string, unknown> | undefined),
      };
    }

    if (purchase.status !== TICKET_PURCHASE_STATUS.PENDING_APPROVAL) {
      return { kind: 'invalid_status' as const };
    }

    const ticketTypeRows = await database
      .select({
        id: dbSchema.ticketType.id,
        totalCount: dbSchema.ticketType.totalCount,
        expiresInDays: dbSchema.ticketType.expiresInDays,
      })
      .from(dbSchema.ticketType)
      .where(eq(dbSchema.ticketType.id, purchase.ticketTypeId))
      .limit(1);
    const ticketType = ticketTypeRows[0];
    if (!ticketType) {
      return { kind: 'ticket_type_not_found' as const };
    }

    const expiresAt = resolveEndDate(ticketType.expiresInDays, undefined);
    const issued = await issueTicketPackWithLedger({
      organizationId: purchase.organizationId,
      participantId: purchase.participantId,
      ticketTypeId: purchase.ticketTypeId,
      count: ticketType.totalCount,
      expiresAt,
      actorUserId,
      reason: actorReason,
    });

    const updatedRows = await database
      .update(dbSchema.ticketPurchase)
      .set({
        status: TICKET_PURCHASE_STATUS.APPROVED,
        ticketPackId: issued.ticketPackId,
        approvedByUserId: actorUserId,
        approvedAt: new Date(),
        rejectedByUserId: null,
        rejectedAt: null,
        rejectReason: null,
      })
      .where(
        and(
          eq(dbSchema.ticketPurchase.id, purchaseId),
          eq(dbSchema.ticketPurchase.status, TICKET_PURCHASE_STATUS.PENDING_APPROVAL),
        ),
      )
      .returning({
        id: dbSchema.ticketPurchase.id,
      });

    if (!updatedRows[0]) {
      await database.delete(dbSchema.ticketLedger).where(eq(dbSchema.ticketLedger.ticketPackId, issued.ticketPackId));
      await database.delete(dbSchema.ticketPack).where(eq(dbSchema.ticketPack.id, issued.ticketPackId));
      return { kind: 'invalid_status' as const };
    }

    const rows = await database
      .select()
      .from(dbSchema.ticketPurchase)
      .where(eq(dbSchema.ticketPurchase.id, purchaseId))
      .limit(1);

    return {
      kind: 'approved' as const,
      purchase: serializeTicketPurchase(rows[0] as Record<string, unknown> | undefined),
      ticketPack: issued.ticketPack,
    };
  };

  const requireAdmin = async ({
    headers,
    organizationId,
  }: {
    headers: Headers;
    organizationId: string;
  }) => {
    const identity = await requireIdentity(headers);
    if (!identity) {
      return { response: new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }) };
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return { response: new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }) };
    }

    return { identity, response: null as Response | null };
  };

  authRoutes.openapi(createServiceImageUploadUrlRoute, async (c) => {
    if (!serviceImageUploadService) {
      return c.json({ message: 'Service image upload is not configured.' }, 503);
    }

    const body = c.req.valid('json');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    try {
      const uploadUrl = await serviceImageUploadService.createSignedUploadUrl({
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

  authRoutes.openapi(uploadServiceImageBySignedUrlRoute, async (c) => {
    if (!serviceImageUploadService) {
      return c.json({ message: 'Service image upload is not configured.' }, 503);
    }

    const { token } = c.req.valid('param');
    try {
      const uploaded = await serviceImageUploadService.uploadBySignedUrl(token, c.req.raw);
      return c.json(uploaded, 201);
    } catch (error) {
      if (error instanceof ServiceImageUploadError) {
        return c.json({ message: error.message }, error.status as 400 | 401 | 413 | 503);
      }
      throw error;
    }
  });

  authRoutes.openapi(getServiceImageRoute, async (c) => {
    if (!serviceImageUploadService) {
      return c.text('Service image delivery is not configured.', 503);
    }

    const { key } = c.req.valid('param');
    const object = await serviceImageUploadService.get(key);
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

  authRoutes.openapi(createServiceRoute, async (c) => {
    const body = c.req.valid('json');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const timezone = assertSupportedTimezone(body.timezone);
    if (!timezone) {
      return c.json({ message: `Only ${DEFAULT_TIMEZONE} is supported in MVP.` }, 422);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const createdId = crypto.randomUUID();
    await database.insert(dbSchema.service).values({
      id: createdId,
      organizationId,
      name: body.name,
      description: normalizeServiceDescription(body.description) ?? null,
      kind: body.kind,
      imageUrl: body.imageUrl ?? null,
      durationMinutes: body.durationMinutes,
      capacity: body.capacity,
      bookingOpenMinutesBefore: body.bookingOpenMinutesBefore,
      bookingCloseMinutesBefore: body.bookingCloseMinutesBefore,
      cancellationDeadlineMinutes: body.cancellationDeadlineMinutes,
      timezone,
      bookingPolicy: body.bookingPolicy ?? 'instant',
      requiresTicket: body.requiresTicket ?? false,
      isActive: body.isActive ?? true,
    });

    const rows = await database
      .select()
      .from(dbSchema.service)
      .where(eq(dbSchema.service.id, createdId))
      .limit(1);

    const service = rows[0];
    return c.json(
      {
        ...service,
        createdAt: toIsoDate(service?.createdAt),
        updatedAt: toIsoDate(service?.updatedAt),
      },
      200,
    );
  });

  authRoutes.openapi(listServicesRoute, async (c) => {
    const query = c.req.valid('query');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const filters = [eq(dbSchema.service.organizationId, organizationId)];
    if (!query.includeArchived) {
      filters.push(eq(dbSchema.service.isActive, true));
    }

    const rows = await database
      .select()
      .from(dbSchema.service)
      .where(and(...filters))
      .orderBy(desc(dbSchema.service.createdAt));

    return c.json(
      rows.map((row: any) => ({
        ...row,
        createdAt: toIsoDate(row.createdAt),
        updatedAt: toIsoDate(row.updatedAt),
      })),
      200,
    );
  });

  authRoutes.openapi(updateServiceRoute, async (c) => {
    const body = c.req.valid('json');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const currentRows = await database
      .select({
        id: dbSchema.service.id,
        organizationId: dbSchema.service.organizationId,
      })
      .from(dbSchema.service)
      .where(eq(dbSchema.service.id, body.serviceId))
      .limit(1);
    const current = currentRows[0];
    if (!current) {
      return c.json({ message: 'Service not found.' }, 404);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId: current.organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    if (body.timezone && !isSupportedTimezone(body.timezone)) {
      return c.json({ message: `Only ${DEFAULT_TIMEZONE} is supported in MVP.` }, 422);
    }

    await database
      .update(dbSchema.service)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: normalizeServiceDescription(body.description) }
          : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
        ...(body.durationMinutes !== undefined ? { durationMinutes: body.durationMinutes } : {}),
        ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
        ...(body.bookingOpenMinutesBefore !== undefined
          ? { bookingOpenMinutesBefore: body.bookingOpenMinutesBefore }
          : {}),
        ...(body.bookingCloseMinutesBefore !== undefined
          ? { bookingCloseMinutesBefore: body.bookingCloseMinutesBefore }
          : {}),
        ...(body.cancellationDeadlineMinutes !== undefined
          ? { cancellationDeadlineMinutes: body.cancellationDeadlineMinutes }
          : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.bookingPolicy !== undefined ? { bookingPolicy: body.bookingPolicy } : {}),
        ...(body.requiresTicket !== undefined ? { requiresTicket: body.requiresTicket } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      })
      .where(eq(dbSchema.service.id, body.serviceId));

    const rows = await database
      .select()
      .from(dbSchema.service)
      .where(eq(dbSchema.service.id, body.serviceId))
      .limit(1);
    const service = rows[0];
    return c.json(
      {
        ...service,
        createdAt: toIsoDate(service?.createdAt),
        updatedAt: toIsoDate(service?.updatedAt),
      },
      200,
    );
  });

  authRoutes.openapi(archiveServiceRoute, async (c) => {
    const body = c.req.valid('json');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const serviceRows = await database
      .select({
        id: dbSchema.service.id,
        organizationId: dbSchema.service.organizationId,
      })
      .from(dbSchema.service)
      .where(eq(dbSchema.service.id, body.serviceId))
      .limit(1);
    const service = serviceRows[0];
    if (!service) {
      return c.json({ message: 'Service not found.' }, 404);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId: service.organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    await database
      .update(dbSchema.service)
      .set({
        isActive: false,
      })
      .where(eq(dbSchema.service.id, service.id));

    return c.json({ ok: true }, 200);
  });

  authRoutes.openapi(createSlotRoute, async (c) => {
    const body = c.req.valid('json');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const startAt = parseIsoDateOrNull(body.startAt);
    const endAt = parseIsoDateOrNull(body.endAt);
    if (!startAt || !endAt || startAt.getTime() >= endAt.getTime()) {
      return c.json({ message: 'Invalid slot startAt/endAt.' }, 422);
    }

    const serviceRows = await database
      .select()
      .from(dbSchema.service)
      .where(eq(dbSchema.service.id, body.serviceId))
      .limit(1);
    const service = serviceRows[0];
    if (!service) {
      return c.json({ message: 'Service not found.' }, 404);
    }

    const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
    if (!organizationId || organizationId !== service.organizationId) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const bookingOpenAt =
      typeof service.bookingOpenMinutesBefore === 'number'
        ? new Date(startAt.getTime() - service.bookingOpenMinutesBefore * 60 * 1000)
        : new Date();
    const bookingCloseAt =
      typeof service.bookingCloseMinutesBefore === 'number'
        ? new Date(startAt.getTime() - service.bookingCloseMinutesBefore * 60 * 1000)
        : startAt;
    const finalBookingOpenAt =
      bookingOpenAt.getTime() <= bookingCloseAt.getTime() ? bookingOpenAt : bookingCloseAt;

    const slotId = crypto.randomUUID();
    await database.insert(dbSchema.slot).values({
      id: slotId,
      organizationId,
      serviceId: service.id,
      recurringScheduleId: null,
      startAt,
      endAt,
      capacity: body.capacity ?? service.capacity,
      reservedCount: 0,
      status: SLOT_STATUS.OPEN,
      staffLabel: body.staffLabel ?? null,
      locationLabel: body.locationLabel ?? null,
      bookingOpenAt: finalBookingOpenAt,
      bookingCloseAt,
    });

    const rows = await database
      .select()
      .from(dbSchema.slot)
      .where(eq(dbSchema.slot.id, slotId))
      .limit(1);
    const slot = rows[0];

    return c.json(
      {
        ...slot,
        startAt: toIsoDate(slot?.startAt),
        endAt: toIsoDate(slot?.endAt),
        bookingOpenAt: toIsoDate(slot?.bookingOpenAt),
        bookingCloseAt: toIsoDate(slot?.bookingCloseAt),
        createdAt: toIsoDate(slot?.createdAt),
        updatedAt: toIsoDate(slot?.updatedAt),
      },
      200,
    );
  });

  authRoutes.openapi(listSlotsRoute, async (c) => {
    const query = c.req.valid('query');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const from = parseIsoDateOrNull(query.from);
    const to = parseIsoDateOrNull(query.to);
    if (!from || !to || from.getTime() > to.getTime()) {
      return c.json({ message: 'Invalid from/to.' }, 422);
    }

    const filters = [
      eq(dbSchema.slot.organizationId, organizationId),
      gte(dbSchema.slot.startAt, from),
      lte(dbSchema.slot.startAt, to),
    ];
    if (query.serviceId) {
      filters.push(eq(dbSchema.slot.serviceId, query.serviceId));
    }
    if (query.status) {
      filters.push(eq(dbSchema.slot.status, query.status));
    }

    const rows = await database
      .select()
      .from(dbSchema.slot)
      .where(and(...filters))
      .orderBy(asc(dbSchema.slot.startAt));

    return c.json(
      rows.map((row: any) => ({
        ...row,
        startAt: toIsoDate(row.startAt),
        endAt: toIsoDate(row.endAt),
        bookingOpenAt: toIsoDate(row.bookingOpenAt),
        bookingCloseAt: toIsoDate(row.bookingCloseAt),
        createdAt: toIsoDate(row.createdAt),
        updatedAt: toIsoDate(row.updatedAt),
      })),
      200,
    );
  });

  authRoutes.openapi(listAvailableSlotsRoute, async (c) => {
    const query = c.req.valid('query');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const participant = await findParticipantByUserAndOrganization({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!participant) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const from = parseIsoDateOrNull(query.from);
    const to = parseIsoDateOrNull(query.to);
    if (!from || !to || from.getTime() > to.getTime()) {
      return c.json({ message: 'Invalid from/to.' }, 422);
    }

    const now = new Date();
    const filters = [
      eq(dbSchema.slot.organizationId, organizationId),
      eq(dbSchema.slot.status, SLOT_STATUS.OPEN),
      gte(dbSchema.slot.startAt, from),
      lte(dbSchema.slot.startAt, to),
      lte(dbSchema.slot.bookingOpenAt, now),
      gte(dbSchema.slot.bookingCloseAt, now),
      sql`${dbSchema.slot.reservedCount} < ${dbSchema.slot.capacity}`,
    ];
    if (query.serviceId) {
      filters.push(eq(dbSchema.slot.serviceId, query.serviceId));
    }

    const rows = await database
      .select()
      .from(dbSchema.slot)
      .where(and(...filters))
      .orderBy(asc(dbSchema.slot.startAt));

    return c.json(
      rows.map((row: any) => ({
        ...row,
        startAt: toIsoDate(row.startAt),
        endAt: toIsoDate(row.endAt),
        bookingOpenAt: toIsoDate(row.bookingOpenAt),
        bookingCloseAt: toIsoDate(row.bookingCloseAt),
        createdAt: toIsoDate(row.createdAt),
        updatedAt: toIsoDate(row.updatedAt),
      })),
      200,
    );
  });

  authRoutes.openapi(cancelSlotRoute, async (c) => {
    const body = c.req.valid('json');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const slotRows = await database
      .select({
        id: dbSchema.slot.id,
        organizationId: dbSchema.slot.organizationId,
        status: dbSchema.slot.status,
      })
      .from(dbSchema.slot)
      .where(eq(dbSchema.slot.id, body.slotId))
      .limit(1);
    const slot = slotRows[0];
    if (!slot) {
      return c.json({ message: 'Slot not found.' }, 404);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId: slot.organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    if (slot.status !== SLOT_STATUS.OPEN) {
      return c.json({ message: 'Slot is not open.' }, 409);
    }

    await database
      .update(dbSchema.slot)
      .set({
        status: SLOT_STATUS.CANCELED,
      })
      .where(eq(dbSchema.slot.id, slot.id));

    await database
      .update(dbSchema.booking)
      .set({
        status: BOOKING_STATUS.CANCELED_BY_STAFF,
        cancelReason: body.reason ?? 'slot-canceled',
        cancelledAt: new Date(),
        cancelledByUserId: identity.userId,
      })
      .where(
        and(
          eq(dbSchema.booking.slotId, slot.id),
          eq(dbSchema.booking.status, BOOKING_STATUS.CONFIRMED),
        ),
      );

    return c.json({ ok: true }, 200);
  });

  authRoutes.openapi(createRecurringScheduleRoute, async (c) => {
    const body = c.req.valid('json');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const timezone = assertSupportedTimezone(body.timezone);
    if (!timezone) {
      return c.json({ message: `Only ${DEFAULT_TIMEZONE} is supported in MVP.` }, 422);
    }

    const serviceRows = await database
      .select({
        id: dbSchema.service.id,
        organizationId: dbSchema.service.organizationId,
      })
      .from(dbSchema.service)
      .where(eq(dbSchema.service.id, body.serviceId))
      .limit(1);
    const service = serviceRows[0];
    if (!service) {
      return c.json({ message: 'Service not found.' }, 404);
    }

    const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
    if (!organizationId || organizationId !== service.organizationId) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    if (body.frequency === 'weekly' && body.byWeekday && body.byWeekday.length === 0) {
      return c.json({ message: 'byWeekday must not be empty for weekly frequency.' }, 422);
    }

    const startDateParts = parseDateParts(body.startDate);
    if (!startDateParts) {
      return c.json({ message: 'Invalid startDate.' }, 422);
    }

    if (body.endDate) {
      const endDateParts = parseDateParts(body.endDate);
      if (!endDateParts) {
        return c.json({ message: 'Invalid endDate.' }, 422);
      }
      if (new Date(body.endDate).getTime() < new Date(body.startDate).getTime()) {
        return c.json({ message: 'endDate must be >= startDate.' }, 422);
      }
    }

    const recurringScheduleId = crypto.randomUUID();
    await database.insert(dbSchema.recurringSchedule).values({
      id: recurringScheduleId,
      organizationId,
      serviceId: body.serviceId,
      timezone,
      frequency: body.frequency,
      interval: body.interval,
      byWeekdayJson: body.byWeekday ? JSON.stringify(body.byWeekday) : null,
      byMonthday: body.byMonthday ?? null,
      startDate: body.startDate,
      endDate: body.endDate ?? null,
      startTimeLocal: body.startTimeLocal,
      durationMinutes: body.durationMinutes ?? null,
      capacityOverride: body.capacityOverride ?? null,
      isActive: true,
    });

    const { from, to } = defaultRecurringRange();
    const generated = await syncRecurringScheduleSlots({
      database,
      scheduleId: recurringScheduleId,
      from,
      to,
    });

    const rows = await database
      .select()
      .from(dbSchema.recurringSchedule)
      .where(eq(dbSchema.recurringSchedule.id, recurringScheduleId))
      .limit(1);
    const schedule = rows[0];

    return c.json(
      {
        ...schedule,
        byWeekday: schedule?.byWeekdayJson ? JSON.parse(schedule.byWeekdayJson) : [],
        createdAt: toIsoDate(schedule?.createdAt),
        updatedAt: toIsoDate(schedule?.updatedAt),
        lastGeneratedAt: toIsoDate(schedule?.lastGeneratedAt),
        generated,
      },
      200,
    );
  });

  authRoutes.openapi(listRecurringSchedulesRoute, async (c) => {
    const query = c.req.valid('query');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const filters = [eq(dbSchema.recurringSchedule.organizationId, organizationId)];
    if (query.serviceId) {
      filters.push(eq(dbSchema.recurringSchedule.serviceId, query.serviceId));
    }
    if (query.isActive !== undefined) {
      filters.push(eq(dbSchema.recurringSchedule.isActive, query.isActive));
    }

    const rows = await database
      .select()
      .from(dbSchema.recurringSchedule)
      .where(and(...filters))
      .orderBy(desc(dbSchema.recurringSchedule.createdAt));

    return c.json(
      rows.map((row: any) => ({
        ...row,
        byWeekday: row.byWeekdayJson ? JSON.parse(row.byWeekdayJson) : [],
        createdAt: toIsoDate(row.createdAt),
        updatedAt: toIsoDate(row.updatedAt),
        lastGeneratedAt: toIsoDate(row.lastGeneratedAt),
      })),
      200,
    );
  });

  authRoutes.openapi(updateRecurringScheduleRoute, async (c) => {
    const body = c.req.valid('json');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const scheduleRows = await database
      .select({
        id: dbSchema.recurringSchedule.id,
        organizationId: dbSchema.recurringSchedule.organizationId,
      })
      .from(dbSchema.recurringSchedule)
      .where(eq(dbSchema.recurringSchedule.id, body.recurringScheduleId))
      .limit(1);
    const schedule = scheduleRows[0];
    if (!schedule) {
      return c.json({ message: 'Recurring schedule not found.' }, 404);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId: schedule.organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    if (body.timezone && !isSupportedTimezone(body.timezone)) {
      return c.json({ message: `Only ${DEFAULT_TIMEZONE} is supported in MVP.` }, 422);
    }
    if (body.startDate && !parseDateParts(body.startDate)) {
      return c.json({ message: 'Invalid startDate.' }, 422);
    }
    if (body.endDate && !parseDateParts(body.endDate)) {
      return c.json({ message: 'Invalid endDate.' }, 422);
    }

    await database
      .update(dbSchema.recurringSchedule)
      .set({
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
        ...(body.interval !== undefined ? { interval: body.interval } : {}),
        ...(body.byWeekday !== undefined ? { byWeekdayJson: JSON.stringify(body.byWeekday) } : {}),
        ...(body.byMonthday !== undefined ? { byMonthday: body.byMonthday } : {}),
        ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
        ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
        ...(body.startTimeLocal !== undefined ? { startTimeLocal: body.startTimeLocal } : {}),
        ...(body.durationMinutes !== undefined ? { durationMinutes: body.durationMinutes } : {}),
        ...(body.capacityOverride !== undefined ? { capacityOverride: body.capacityOverride } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      })
      .where(eq(dbSchema.recurringSchedule.id, schedule.id));

    const { from, to } = defaultRecurringRange();
    const generated = await syncRecurringScheduleSlots({
      database,
      scheduleId: schedule.id,
      from,
      to,
    });

    const rows = await database
      .select()
      .from(dbSchema.recurringSchedule)
      .where(eq(dbSchema.recurringSchedule.id, schedule.id))
      .limit(1);
    const updated = rows[0];

    return c.json(
      {
        ...updated,
        byWeekday: updated?.byWeekdayJson ? JSON.parse(updated.byWeekdayJson) : [],
        createdAt: toIsoDate(updated?.createdAt),
        updatedAt: toIsoDate(updated?.updatedAt),
        lastGeneratedAt: toIsoDate(updated?.lastGeneratedAt),
        generated,
      },
      200,
    );
  });

  authRoutes.openapi(upsertRecurringExceptionRoute, async (c) => {
    const body = c.req.valid('json');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    if (body.action === 'override') {
      const hasAnyOverride =
        body.overrideStartTimeLocal !== undefined ||
        body.overrideDurationMinutes !== undefined ||
        body.overrideCapacity !== undefined;
      if (!hasAnyOverride) {
        return c.json({ message: 'Override action requires at least one override field.' }, 422);
      }
    }

    const scheduleRows = await database
      .select({
        id: dbSchema.recurringSchedule.id,
        organizationId: dbSchema.recurringSchedule.organizationId,
      })
      .from(dbSchema.recurringSchedule)
      .where(eq(dbSchema.recurringSchedule.id, body.recurringScheduleId))
      .limit(1);
    const schedule = scheduleRows[0];
    if (!schedule) {
      return c.json({ message: 'Recurring schedule not found.' }, 404);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId: schedule.organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const existingRows = await database
      .select({
        id: dbSchema.recurringScheduleException.id,
      })
      .from(dbSchema.recurringScheduleException)
      .where(
        and(
          eq(dbSchema.recurringScheduleException.recurringScheduleId, body.recurringScheduleId),
          eq(dbSchema.recurringScheduleException.date, body.date),
        ),
      )
      .limit(1);

    if (existingRows[0]) {
      await database
        .update(dbSchema.recurringScheduleException)
        .set({
          action: body.action,
          overrideStartTimeLocal: body.overrideStartTimeLocal ?? null,
          overrideDurationMinutes: body.overrideDurationMinutes ?? null,
          overrideCapacity: body.overrideCapacity ?? null,
        })
        .where(eq(dbSchema.recurringScheduleException.id, existingRows[0].id));
    } else {
      await database.insert(dbSchema.recurringScheduleException).values({
        id: crypto.randomUUID(),
        recurringScheduleId: body.recurringScheduleId,
        organizationId: schedule.organizationId,
        date: body.date,
        action: body.action,
        overrideStartTimeLocal: body.overrideStartTimeLocal ?? null,
        overrideDurationMinutes: body.overrideDurationMinutes ?? null,
        overrideCapacity: body.overrideCapacity ?? null,
      });
    }

    const { from, to } = defaultRecurringRange();
    const generated = await syncRecurringScheduleSlots({
      database,
      scheduleId: body.recurringScheduleId,
      from,
      to,
    });

    const rows = await database
      .select()
      .from(dbSchema.recurringScheduleException)
      .where(
        and(
          eq(dbSchema.recurringScheduleException.recurringScheduleId, body.recurringScheduleId),
          eq(dbSchema.recurringScheduleException.date, body.date),
        ),
      )
      .limit(1);
    const exception = rows[0];

    return c.json(
      {
        ...exception,
        createdAt: toIsoDate(exception?.createdAt),
        updatedAt: toIsoDate(exception?.updatedAt),
        generated,
      },
      200,
    );
  });

  authRoutes.openapi(generateRecurringSlotsRoute, async (c) => {
    const body = c.req.valid('json');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const scheduleRows = await database
      .select({
        id: dbSchema.recurringSchedule.id,
        organizationId: dbSchema.recurringSchedule.organizationId,
      })
      .from(dbSchema.recurringSchedule)
      .where(eq(dbSchema.recurringSchedule.id, body.recurringScheduleId))
      .limit(1);
    const schedule = scheduleRows[0];
    if (!schedule) {
      return c.json({ message: 'Recurring schedule not found.' }, 404);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId: schedule.organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const defaultRange = defaultRecurringRange();
    const from = parseIsoDateOrNull(body.from) ?? defaultRange.from;
    const to = parseIsoDateOrNull(body.to) ?? defaultRange.to;
    if (from.getTime() > to.getTime()) {
      return c.json({ message: 'Invalid from/to.' }, 422);
    }

    const generated = await syncRecurringScheduleSlots({
      database,
      scheduleId: body.recurringScheduleId,
      from,
      to,
    });

    return c.json(
      {
        recurringScheduleId: body.recurringScheduleId,
        from: from.toISOString(),
        to: to.toISOString(),
        ...generated,
      },
      200,
    );
  });

  authRoutes.openapi(createBookingRoute, async (c) => {
    const body = c.req.valid('json');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const participantsCount = body.participantsCount ?? 1;
    const slotRows = await database
      .select({
        id: dbSchema.slot.id,
        organizationId: dbSchema.slot.organizationId,
        serviceId: dbSchema.slot.serviceId,
        startAt: dbSchema.slot.startAt,
        status: dbSchema.slot.status,
        bookingOpenAt: dbSchema.slot.bookingOpenAt,
        bookingCloseAt: dbSchema.slot.bookingCloseAt,
      })
      .from(dbSchema.slot)
      .where(eq(dbSchema.slot.id, body.slotId))
      .limit(1);
    const slot = slotRows[0];
    if (!slot) {
      return c.json({ message: 'Slot not found.' }, 404);
    }

    const participant = await findParticipantByUserAndOrganization({
      database,
      organizationId: slot.organizationId,
      userId: identity.userId,
    });
    if (!participant) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const serviceRows = await database
      .select({
        id: dbSchema.service.id,
        bookingPolicy: dbSchema.service.bookingPolicy,
        requiresTicket: dbSchema.service.requiresTicket,
      })
      .from(dbSchema.service)
      .where(eq(dbSchema.service.id, slot.serviceId))
      .limit(1);
    const service = serviceRows[0];
    if (!service) {
      return c.json({ message: 'Service not found.' }, 404);
    }

    const now = new Date();
    if (
      slot.status !== SLOT_STATUS.OPEN ||
      now.getTime() < new Date(slot.bookingOpenAt).getTime() ||
      now.getTime() > new Date(slot.bookingCloseAt).getTime()
    ) {
      return c.json({ message: 'Slot is not bookable.' }, 409);
    }

    const bookingPolicy = resolveBookingPolicy(service.bookingPolicy);
    if (bookingPolicy === 'approval') {
      try {
        const bookingId = crypto.randomUUID();
        await database.insert(dbSchema.booking).values({
          id: bookingId,
          organizationId: slot.organizationId,
          slotId: slot.id,
          serviceId: slot.serviceId,
          participantId: participant.id,
          participantsCount,
          status: BOOKING_STATUS.PENDING_APPROVAL,
          ticketPackId: null,
        });

        await database.insert(dbSchema.bookingAuditLog).values({
          id: crypto.randomUUID(),
          bookingId,
          organizationId: slot.organizationId,
          actorUserId: identity.userId,
          action: 'booking.application_received',
          metadata: JSON.stringify({
            participantsCount,
          }),
          ipAddress: headers.get('cf-connecting-ip') ?? null,
          userAgent: headers.get('user-agent'),
        });

        const rows = await database
          .select()
          .from(dbSchema.booking)
          .where(eq(dbSchema.booking.id, bookingId))
          .limit(1);
        const booking = rows[0];

        await notifyBookingEmailBestEffort({
          bookingId,
          event: 'booking_application_received',
        });

        return c.json(
          {
            ...booking,
            cancelledAt: toIsoDate(booking?.cancelledAt),
            noShowMarkedAt: toIsoDate(booking?.noShowMarkedAt),
            createdAt: toIsoDate(booking?.createdAt),
            updatedAt: toIsoDate(booking?.updatedAt),
          },
          200,
        );
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return c.json({ message: 'Duplicate booking is not allowed.' }, 409);
        }
        throw error;
      }
    }

    let capacityReserved = false;
    let consumedTicketPackId: string | null = null;
    let bookingCreated = false;

    const releaseReservedCapacity = async () => {
      if (!capacityReserved) {
        return;
      }
      await database
        .update(dbSchema.slot)
        .set({
          reservedCount: sql`case
            when ${dbSchema.slot.reservedCount} >= ${participantsCount}
            then ${dbSchema.slot.reservedCount} - ${participantsCount}
            else 0
          end`,
        })
        .where(eq(dbSchema.slot.id, slot.id));
      capacityReserved = false;
    };

    const restoreConsumedTicket = async () => {
      if (!consumedTicketPackId) {
        return;
      }
      const restoredRows = await database
        .update(dbSchema.ticketPack)
        .set({
          remainingCount: sql`${dbSchema.ticketPack.remainingCount} + ${participantsCount}`,
        })
        .where(eq(dbSchema.ticketPack.id, consumedTicketPackId))
        .returning({
          id: dbSchema.ticketPack.id,
          remainingCount: dbSchema.ticketPack.remainingCount,
          expiresAt: dbSchema.ticketPack.expiresAt,
        });
      const restoredPack = restoredRows[0];
      if (restoredPack) {
        const packStatus = normalizePackStatus({
          remainingCount: restoredPack.remainingCount,
          expiresAt: restoredPack.expiresAt,
        });
        await database
          .update(dbSchema.ticketPack)
          .set({
            status: packStatus,
          })
          .where(eq(dbSchema.ticketPack.id, restoredPack.id));
      }
      consumedTicketPackId = null;
    };

    try {
      const capacityRows = await database
        .update(dbSchema.slot)
        .set({
          reservedCount: sql`${dbSchema.slot.reservedCount} + ${participantsCount}`,
        })
        .where(
          and(
            eq(dbSchema.slot.id, slot.id),
            eq(dbSchema.slot.status, SLOT_STATUS.OPEN),
            lte(dbSchema.slot.bookingOpenAt, now),
            gte(dbSchema.slot.bookingCloseAt, now),
            sql`${dbSchema.slot.reservedCount} + ${participantsCount} <= ${dbSchema.slot.capacity}`,
          ),
        )
        .returning({ id: dbSchema.slot.id });
      if (capacityRows.length === 0) {
        throw new Error('CAPACITY_OR_TIME_CONFLICT');
      }
      capacityReserved = true;

      let consumedBalanceAfter: number | null = null;
      if (service.requiresTicket) {
        const consumed = await consumeTicketPackForParticipant({
          organizationId: slot.organizationId,
          participantId: participant.id,
          participantsCount,
          now,
        });
        consumedTicketPackId = consumed.ticketPackId;
        consumedBalanceAfter = consumed.balanceAfter;
      }

      const bookingId = crypto.randomUUID();
      await database.insert(dbSchema.booking).values({
        id: bookingId,
        organizationId: slot.organizationId,
        slotId: slot.id,
        serviceId: slot.serviceId,
        participantId: participant.id,
        participantsCount,
        status: BOOKING_STATUS.CONFIRMED,
        ticketPackId: consumedTicketPackId,
      });
      bookingCreated = true;

      if (consumedTicketPackId) {
        await database.insert(dbSchema.ticketLedger).values({
          id: crypto.randomUUID(),
          organizationId: slot.organizationId,
          ticketPackId: consumedTicketPackId,
          bookingId,
          action: TICKET_LEDGER_ACTION.CONSUME,
          delta: participantsCount * -1,
          balanceAfter: consumedBalanceAfter ?? 0,
          actorUserId: identity.userId,
          reason: 'booking-created',
        });
      }

      await database.insert(dbSchema.bookingAuditLog).values({
        id: crypto.randomUUID(),
        bookingId,
        organizationId: slot.organizationId,
        actorUserId: identity.userId,
        action: 'booking.created',
        metadata: JSON.stringify({
          participantsCount,
        }),
        ipAddress: headers.get('cf-connecting-ip') ?? null,
        userAgent: headers.get('user-agent'),
      });

      const rows = await database
        .select()
        .from(dbSchema.booking)
        .where(eq(dbSchema.booking.id, bookingId))
        .limit(1);
      const booking = rows[0];

      await notifyBookingEmailBestEffort({
        bookingId,
        event: 'booking_confirmed',
      });

      return c.json(
        {
          ...booking,
          cancelledAt: toIsoDate(booking?.cancelledAt),
          noShowMarkedAt: toIsoDate(booking?.noShowMarkedAt),
          createdAt: toIsoDate(booking?.createdAt),
          updatedAt: toIsoDate(booking?.updatedAt),
        },
        200,
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        if (!bookingCreated) {
          await restoreConsumedTicket();
          await releaseReservedCapacity();
        }
        return c.json({ message: 'Duplicate booking is not allowed.' }, 409);
      }
      if (error instanceof Error && error.message === 'CAPACITY_OR_TIME_CONFLICT') {
        return c.json({ message: 'Slot is full or not bookable.' }, 409);
      }
      if (error instanceof Error && (error.message === 'TICKET_REQUIRED' || error.message === 'TICKET_CONFLICT')) {
        await restoreConsumedTicket();
        await releaseReservedCapacity();
        return c.json({ message: 'No available ticket pack for booking.' }, 409);
      }
      if (!bookingCreated) {
        await restoreConsumedTicket();
        await releaseReservedCapacity();
      }
      throw error;
    }
  });

  authRoutes.openapi(listMyBookingsRoute, async (c) => {
    const query = c.req.valid('query');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const participant = await findParticipantByUserAndOrganization({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!participant) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const filters = [
      eq(dbSchema.booking.organizationId, organizationId),
      eq(dbSchema.booking.participantId, participant.id),
    ];
    if (query.status) {
      filters.push(eq(dbSchema.booking.status, query.status));
    }

    const from = parseIsoDateOrNull(query.from);
    const to = parseIsoDateOrNull(query.to);
    if (from) {
      filters.push(gte(dbSchema.booking.createdAt, from));
    }
    if (to) {
      filters.push(lte(dbSchema.booking.createdAt, to));
    }

    const rows = await database
      .select()
      .from(dbSchema.booking)
      .where(and(...filters))
      .orderBy(desc(dbSchema.booking.createdAt));

    return c.json(
      rows.map((row: any) => ({
        ...row,
        cancelledAt: toIsoDate(row.cancelledAt),
        noShowMarkedAt: toIsoDate(row.noShowMarkedAt),
        createdAt: toIsoDate(row.createdAt),
        updatedAt: toIsoDate(row.updatedAt),
      })),
      200,
    );
  });

  authRoutes.openapi(cancelBookingRoute, async (c) => {
    const body = c.req.valid('json');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const bookingRows = await database
      .select({
        id: dbSchema.booking.id,
        organizationId: dbSchema.booking.organizationId,
        participantId: dbSchema.booking.participantId,
        status: dbSchema.booking.status,
        participantsCount: dbSchema.booking.participantsCount,
        ticketPackId: dbSchema.booking.ticketPackId,
        slotId: dbSchema.booking.slotId,
        serviceId: dbSchema.booking.serviceId,
      })
      .from(dbSchema.booking)
      .where(eq(dbSchema.booking.id, body.bookingId))
      .limit(1);
    const booking = bookingRows[0];
    if (!booking) {
      return c.json({ message: 'Booking not found.' }, 404);
    }

    const participant = await findParticipantByUserAndOrganization({
      database,
      organizationId: booking.organizationId,
      userId: identity.userId,
    });
    if (!participant || participant.id !== booking.participantId) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const isPendingApproval = booking.status === BOOKING_STATUS.PENDING_APPROVAL;
    if (!isPendingApproval && booking.status !== BOOKING_STATUS.CONFIRMED) {
      return c.json({ message: 'Booking cannot be canceled.' }, 409);
    }

    if (!isPendingApproval) {
      const slotRows = await database
        .select({
          id: dbSchema.slot.id,
          startAt: dbSchema.slot.startAt,
        })
        .from(dbSchema.slot)
        .where(eq(dbSchema.slot.id, booking.slotId))
        .limit(1);
      const slot = slotRows[0];
      if (!slot) {
        return c.json({ message: 'Slot not found.' }, 404);
      }

      const serviceRows = await database
        .select({
          cancellationDeadlineMinutes: dbSchema.service.cancellationDeadlineMinutes,
        })
        .from(dbSchema.service)
        .where(eq(dbSchema.service.id, booking.serviceId))
        .limit(1);
      const service = serviceRows[0];
      const cancellationDeadlineMinutes =
        service?.cancellationDeadlineMinutes ?? DEFAULT_CANCELLATION_DEADLINE_MINUTES;
      const deadlineAt = new Date(
        new Date(slot.startAt).getTime() - cancellationDeadlineMinutes * 60 * 1000,
      );
      if (Date.now() > deadlineAt.getTime()) {
        return c.json({ message: 'Cancellation deadline has passed.' }, 409);
      }
    }

    await database
      .update(dbSchema.booking)
      .set({
        status: BOOKING_STATUS.CANCELED_BY_PARTICIPANT,
        cancelReason: body.reason ?? null,
        cancelledAt: new Date(),
        cancelledByUserId: identity.userId,
      })
      .where(eq(dbSchema.booking.id, booking.id));

    if (!isPendingApproval) {
      await database
        .update(dbSchema.slot)
        .set({
          reservedCount: sql`${dbSchema.slot.reservedCount} - ${booking.participantsCount}`,
        })
        .where(
          and(
            eq(dbSchema.slot.id, booking.slotId),
            gte(dbSchema.slot.reservedCount, booking.participantsCount),
          ),
        );

      if (booking.ticketPackId) {
        await database
          .update(dbSchema.ticketPack)
          .set({
            remainingCount: sql`${dbSchema.ticketPack.remainingCount} + ${booking.participantsCount}`,
            status: TICKET_PACK_STATUS.ACTIVE,
          })
          .where(eq(dbSchema.ticketPack.id, booking.ticketPackId));

        const packRows = await database
          .select({
            remainingCount: dbSchema.ticketPack.remainingCount,
          })
          .from(dbSchema.ticketPack)
          .where(eq(dbSchema.ticketPack.id, booking.ticketPackId))
          .limit(1);
        const pack = packRows[0];

        await database.insert(dbSchema.ticketLedger).values({
          id: crypto.randomUUID(),
          organizationId: booking.organizationId,
          ticketPackId: booking.ticketPackId,
          bookingId: booking.id,
          action: TICKET_LEDGER_ACTION.RESTORE,
          delta: booking.participantsCount,
          balanceAfter: pack?.remainingCount ?? 0,
          actorUserId: identity.userId,
          reason: 'booking-canceled-by-participant',
        });
      }
    }

    await writeBookingAuditLog({
      database,
      bookingId: booking.id,
      organizationId: booking.organizationId,
      actorUserId: identity.userId,
      action: 'booking.cancelled_by_participant',
      metadata: {
        reason: body.reason ?? null,
      },
      headers,
    });

    await notifyBookingEmailBestEffort({
      bookingId: booking.id,
      event: 'booking_cancelled_by_participant',
      reason: body.reason ?? null,
    });

    return c.json({ ok: true }, 200);
  });

  authRoutes.openapi(listBookingsRoute, async (c) => {
    const query = c.req.valid('query');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const filters = [eq(dbSchema.booking.organizationId, organizationId)];
    if (query.serviceId) {
      filters.push(eq(dbSchema.booking.serviceId, query.serviceId));
    }
    if (query.participantId) {
      filters.push(eq(dbSchema.booking.participantId, query.participantId));
    }
    if (query.status) {
      filters.push(eq(dbSchema.booking.status, query.status));
    }

    const from = parseIsoDateOrNull(query.from);
    const to = parseIsoDateOrNull(query.to);
    if (from) {
      filters.push(gte(dbSchema.booking.createdAt, from));
    }
    if (to) {
      filters.push(lte(dbSchema.booking.createdAt, to));
    }

    const rows = await database
      .select()
      .from(dbSchema.booking)
      .where(and(...filters))
      .orderBy(desc(dbSchema.booking.createdAt));

    return c.json(
      rows.map((row: any) => ({
        ...row,
        cancelledAt: toIsoDate(row.cancelledAt),
        noShowMarkedAt: toIsoDate(row.noShowMarkedAt),
        createdAt: toIsoDate(row.createdAt),
        updatedAt: toIsoDate(row.updatedAt),
      })),
      200,
    );
  });

  authRoutes.openapi(cancelBookingByStaffRoute, async (c) => {
    const body = c.req.valid('json');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const bookingRows = await database
      .select({
        id: dbSchema.booking.id,
        organizationId: dbSchema.booking.organizationId,
        slotId: dbSchema.booking.slotId,
        participantsCount: dbSchema.booking.participantsCount,
        status: dbSchema.booking.status,
      })
      .from(dbSchema.booking)
      .where(eq(dbSchema.booking.id, body.bookingId))
      .limit(1);
    const booking = bookingRows[0];
    if (!booking) {
      return c.json({ message: 'Booking not found.' }, 404);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId: booking.organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    if (booking.status !== BOOKING_STATUS.CONFIRMED) {
      return c.json({ message: 'Booking cannot be canceled.' }, 409);
    }

    await database
      .update(dbSchema.booking)
      .set({
        status: BOOKING_STATUS.CANCELED_BY_STAFF,
        cancelReason: body.reason ?? null,
        cancelledAt: new Date(),
        cancelledByUserId: identity.userId,
      })
      .where(eq(dbSchema.booking.id, booking.id));

    await database
      .update(dbSchema.slot)
      .set({
        reservedCount: sql`${dbSchema.slot.reservedCount} - ${booking.participantsCount}`,
      })
      .where(
        and(
          eq(dbSchema.slot.id, booking.slotId),
          gte(dbSchema.slot.reservedCount, booking.participantsCount),
        ),
      );

    await writeBookingAuditLog({
      database,
      bookingId: booking.id,
      organizationId: booking.organizationId,
      actorUserId: identity.userId,
      action: 'booking.cancelled_by_staff',
      metadata: {
        reason: body.reason ?? null,
      },
      headers,
    });

    await notifyBookingEmailBestEffort({
      bookingId: booking.id,
      event: 'booking_cancelled_by_staff',
      reason: body.reason ?? null,
    });

    return c.json({ ok: true }, 200);
  });

  authRoutes.openapi(approveBookingByStaffRoute, async (c) => {
    const body = c.req.valid('json');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const bookingRows = await database
      .select({
        id: dbSchema.booking.id,
        organizationId: dbSchema.booking.organizationId,
        participantId: dbSchema.booking.participantId,
        serviceId: dbSchema.booking.serviceId,
        slotId: dbSchema.booking.slotId,
        participantsCount: dbSchema.booking.participantsCount,
        status: dbSchema.booking.status,
      })
      .from(dbSchema.booking)
      .where(eq(dbSchema.booking.id, body.bookingId))
      .limit(1);
    const booking = bookingRows[0];
    if (!booking) {
      return c.json({ message: 'Booking not found.' }, 404);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId: booking.organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    if (booking.status !== BOOKING_STATUS.PENDING_APPROVAL) {
      return c.json({ message: 'Only pending approval booking can be approved.' }, 409);
    }

    const serviceRows = await database
      .select({
        requiresTicket: dbSchema.service.requiresTicket,
      })
      .from(dbSchema.service)
      .where(eq(dbSchema.service.id, booking.serviceId))
      .limit(1);
    const service = serviceRows[0];
    if (!service) {
      return c.json({ message: 'Service not found.' }, 404);
    }

    const now = new Date();
    let capacityReserved = false;
    let consumedTicketPackId: string | null = null;
    let consumedBalanceAfter: number | null = null;

    const releaseReservedCapacity = async () => {
      if (!capacityReserved) {
        return;
      }
      await database
        .update(dbSchema.slot)
        .set({
          reservedCount: sql`case
            when ${dbSchema.slot.reservedCount} >= ${booking.participantsCount}
            then ${dbSchema.slot.reservedCount} - ${booking.participantsCount}
            else 0
          end`,
        })
        .where(eq(dbSchema.slot.id, booking.slotId));
      capacityReserved = false;
    };

    const restoreConsumedTicket = async () => {
      if (!consumedTicketPackId) {
        return;
      }
      const restoredRows = await database
        .update(dbSchema.ticketPack)
        .set({
          remainingCount: sql`${dbSchema.ticketPack.remainingCount} + ${booking.participantsCount}`,
        })
        .where(eq(dbSchema.ticketPack.id, consumedTicketPackId))
        .returning({
          id: dbSchema.ticketPack.id,
          remainingCount: dbSchema.ticketPack.remainingCount,
          expiresAt: dbSchema.ticketPack.expiresAt,
        });
      const restoredPack = restoredRows[0];
      if (restoredPack) {
        const packStatus = normalizePackStatus({
          remainingCount: restoredPack.remainingCount,
          expiresAt: restoredPack.expiresAt,
        });
        await database
          .update(dbSchema.ticketPack)
          .set({
            status: packStatus,
          })
          .where(eq(dbSchema.ticketPack.id, restoredPack.id));
      }
      consumedTicketPackId = null;
      consumedBalanceAfter = null;
    };

    try {
      const capacityRows = await database
        .update(dbSchema.slot)
        .set({
          reservedCount: sql`${dbSchema.slot.reservedCount} + ${booking.participantsCount}`,
        })
        .where(
          and(
            eq(dbSchema.slot.id, booking.slotId),
            eq(dbSchema.slot.status, SLOT_STATUS.OPEN),
            sql`${dbSchema.slot.reservedCount} + ${booking.participantsCount} <= ${dbSchema.slot.capacity}`,
          ),
        )
        .returning({ id: dbSchema.slot.id });
      if (capacityRows.length === 0) {
        throw new Error('CAPACITY_OR_SLOT_CONFLICT');
      }
      capacityReserved = true;

      if (service.requiresTicket) {
        const consumed = await consumeTicketPackForParticipant({
          organizationId: booking.organizationId,
          participantId: booking.participantId,
          participantsCount: booking.participantsCount,
          now,
        });
        consumedTicketPackId = consumed.ticketPackId;
        consumedBalanceAfter = consumed.balanceAfter;
      }

      const updatedRows = await database
        .update(dbSchema.booking)
        .set({
          status: BOOKING_STATUS.CONFIRMED,
          ticketPackId: consumedTicketPackId,
        })
        .where(
          and(
            eq(dbSchema.booking.id, booking.id),
            eq(dbSchema.booking.status, BOOKING_STATUS.PENDING_APPROVAL),
          ),
        )
        .returning({ id: dbSchema.booking.id });
      if (updatedRows.length === 0) {
        throw new Error('BOOKING_STATE_CONFLICT');
      }

      if (consumedTicketPackId) {
        await database.insert(dbSchema.ticketLedger).values({
          id: crypto.randomUUID(),
          organizationId: booking.organizationId,
          ticketPackId: consumedTicketPackId,
          bookingId: booking.id,
          action: TICKET_LEDGER_ACTION.CONSUME,
          delta: booking.participantsCount * -1,
          balanceAfter: consumedBalanceAfter ?? 0,
          actorUserId: identity.userId,
          reason: 'booking-approved',
        });
      }

      await writeBookingAuditLog({
        database,
        bookingId: booking.id,
        organizationId: booking.organizationId,
        actorUserId: identity.userId,
        action: 'booking.approved',
        metadata: {
          ticketPackId: consumedTicketPackId,
        },
        headers,
      });

      await notifyBookingEmailBestEffort({
        bookingId: booking.id,
        event: 'booking_approved',
      });

      return c.json({ ok: true }, 200);
    } catch (error) {
      if (error instanceof Error && error.message === 'CAPACITY_OR_SLOT_CONFLICT') {
        return c.json({ message: 'Slot is full or not bookable.' }, 409);
      }
      if (error instanceof Error && (error.message === 'TICKET_REQUIRED' || error.message === 'TICKET_CONFLICT')) {
        await releaseReservedCapacity();
        await restoreConsumedTicket();
        return c.json({ message: 'No available ticket pack for booking.' }, 409);
      }
      if (error instanceof Error && error.message === 'BOOKING_STATE_CONFLICT') {
        await releaseReservedCapacity();
        await restoreConsumedTicket();
        return c.json({ message: 'Only pending approval booking can be approved.' }, 409);
      }
      await releaseReservedCapacity();
      await restoreConsumedTicket();
      throw error;
    }
  });

  authRoutes.openapi(rejectBookingByStaffRoute, async (c) => {
    const body = c.req.valid('json');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const bookingRows = await database
      .select({
        id: dbSchema.booking.id,
        organizationId: dbSchema.booking.organizationId,
        status: dbSchema.booking.status,
      })
      .from(dbSchema.booking)
      .where(eq(dbSchema.booking.id, body.bookingId))
      .limit(1);
    const booking = bookingRows[0];
    if (!booking) {
      return c.json({ message: 'Booking not found.' }, 404);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId: booking.organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    if (booking.status !== BOOKING_STATUS.PENDING_APPROVAL) {
      return c.json({ message: 'Only pending approval booking can be rejected.' }, 409);
    }

    const updatedRows = await database
      .update(dbSchema.booking)
      .set({
        status: BOOKING_STATUS.REJECTED_BY_STAFF,
        cancelReason: body.reason ?? null,
        cancelledAt: new Date(),
        cancelledByUserId: identity.userId,
      })
      .where(
        and(
          eq(dbSchema.booking.id, booking.id),
          eq(dbSchema.booking.status, BOOKING_STATUS.PENDING_APPROVAL),
        ),
      )
      .returning({ id: dbSchema.booking.id });
    if (updatedRows.length === 0) {
      return c.json({ message: 'Only pending approval booking can be rejected.' }, 409);
    }

    await writeBookingAuditLog({
      database,
      bookingId: booking.id,
      organizationId: booking.organizationId,
      actorUserId: identity.userId,
      action: 'booking.rejected_by_staff',
      metadata: {
        reason: body.reason ?? null,
      },
      headers,
    });

    await notifyBookingEmailBestEffort({
      bookingId: booking.id,
      event: 'booking_rejected',
      reason: body.reason ?? null,
    });

    return c.json({ ok: true }, 200);
  });

  authRoutes.openapi(markNoShowRoute, async (c) => {
    const body = c.req.valid('json');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const bookingRows = await database
      .select({
        id: dbSchema.booking.id,
        organizationId: dbSchema.booking.organizationId,
        status: dbSchema.booking.status,
      })
      .from(dbSchema.booking)
      .where(eq(dbSchema.booking.id, body.bookingId))
      .limit(1);
    const booking = bookingRows[0];
    if (!booking) {
      return c.json({ message: 'Booking not found.' }, 404);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId: booking.organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    if (booking.status !== BOOKING_STATUS.CONFIRMED) {
      return c.json({ message: 'Only confirmed booking can be marked as no-show.' }, 409);
    }

    await database
      .update(dbSchema.booking)
      .set({
        status: BOOKING_STATUS.NO_SHOW,
        noShowMarkedAt: new Date(),
      })
      .where(eq(dbSchema.booking.id, booking.id));

    await writeBookingAuditLog({
      database,
      bookingId: booking.id,
      organizationId: booking.organizationId,
      actorUserId: identity.userId,
      action: 'booking.no_show',
      headers,
    });

    await notifyBookingEmailBestEffort({
      bookingId: booking.id,
      event: 'booking_no_show',
    });

    return c.json({ ok: true }, 200);
  });

  authRoutes.openapi(createTicketTypeRoute, async (c) => {
    const body = c.req.valid('json');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    if (body.serviceIds && body.serviceIds.length > 0) {
      const serviceCount = await database
        .select({
          value: sql<number>`count(*)`,
        })
        .from(dbSchema.service)
        .where(
          and(
            eq(dbSchema.service.organizationId, organizationId),
            sql`${dbSchema.service.id} in (${sql.join(
              body.serviceIds.map((id) => sql`${id}`),
              sql`,`,
            )})`,
          ),
        );

      if (Number(serviceCount[0]?.value ?? 0) !== body.serviceIds.length) {
        return c.json({ message: 'serviceIds includes unknown service.' }, 422);
      }
    }

    if (body.isForSale && !body.stripePriceId) {
      return c.json({ message: 'stripePriceId is required when isForSale is true.' }, 422);
    }

    const ticketTypeId = crypto.randomUUID();
    await database.insert(dbSchema.ticketType).values({
      id: ticketTypeId,
      organizationId,
      name: body.name,
      serviceIdsJson: body.serviceIds ? JSON.stringify(body.serviceIds) : null,
      totalCount: body.totalCount,
      expiresInDays: body.expiresInDays ?? null,
      isActive: body.isActive ?? true,
      isForSale: body.isForSale ?? false,
      stripePriceId: body.stripePriceId ?? null,
    });

    const rows = await database
      .select()
      .from(dbSchema.ticketType)
      .where(eq(dbSchema.ticketType.id, ticketTypeId))
      .limit(1);
    const ticketType = rows[0];

    return c.json(serializeTicketType(ticketType as Record<string, unknown> | undefined), 200);
  });

  authRoutes.openapi(listTicketTypesRoute, async (c) => {
    const query = c.req.valid('query');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const filters = [eq(dbSchema.ticketType.organizationId, organizationId)];
    if (query.isActive !== undefined) {
      filters.push(eq(dbSchema.ticketType.isActive, query.isActive));
    }

    const rows = await database
      .select()
      .from(dbSchema.ticketType)
      .where(and(...filters))
      .orderBy(desc(dbSchema.ticketType.createdAt));

    return c.json(rows.map((row: any) => serializeTicketType(row)), 200);
  });

  authRoutes.openapi(listPurchasableTicketTypesRoute, async (c) => {
    const query = c.req.valid('query');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const participant = await findParticipantByUserAndOrganization({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!participant) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const rows = await database
      .select()
      .from(dbSchema.ticketType)
      .where(
        and(
          eq(dbSchema.ticketType.organizationId, organizationId),
          eq(dbSchema.ticketType.isActive, true),
          eq(dbSchema.ticketType.isForSale, true),
        ),
      )
      .orderBy(desc(dbSchema.ticketType.createdAt));

    return c.json(rows.map((row: any) => serializeTicketType(row)), 200);
  });

  authRoutes.openapi(createTicketPurchaseRoute, async (c) => {
    const body = c.req.valid('json');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const participant = await findParticipantByUserAndOrganization({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!participant) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const ticketTypeRows = await database
      .select({
        id: dbSchema.ticketType.id,
        organizationId: dbSchema.ticketType.organizationId,
        totalCount: dbSchema.ticketType.totalCount,
        isActive: dbSchema.ticketType.isActive,
        isForSale: dbSchema.ticketType.isForSale,
        stripePriceId: dbSchema.ticketType.stripePriceId,
      })
      .from(dbSchema.ticketType)
      .where(
        and(
          eq(dbSchema.ticketType.id, body.ticketTypeId),
          eq(dbSchema.ticketType.organizationId, organizationId),
        ),
      )
      .limit(1);
    const ticketType = ticketTypeRows[0];
    if (!ticketType) {
      return c.json({ message: 'Ticket type not found.' }, 404);
    }
    if (!ticketType.isActive || !ticketType.isForSale) {
      return c.json({ message: 'Ticket type is not purchasable.' }, 409);
    }

    const purchaseId = crypto.randomUUID();
    const baseStatus =
      body.paymentMethod === TICKET_PURCHASE_METHOD.STRIPE
        ? TICKET_PURCHASE_STATUS.PENDING_PAYMENT
        : TICKET_PURCHASE_STATUS.PENDING_APPROVAL;

    await database.insert(dbSchema.ticketPurchase).values({
      id: purchaseId,
      organizationId,
      participantId: participant.id,
      ticketTypeId: ticketType.id,
      paymentMethod: body.paymentMethod,
      status: baseStatus,
    });

    let checkoutUrl: string | null = null;
    if (body.paymentMethod === TICKET_PURCHASE_METHOD.STRIPE) {
      if (!ticketType.stripePriceId) {
        await database.delete(dbSchema.ticketPurchase).where(eq(dbSchema.ticketPurchase.id, purchaseId));
        return c.json({ message: 'stripePriceId is not configured for ticket type.' }, 422);
      }

      const webBaseUrl = (env.WEB_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
      const successUrl = `${webBaseUrl}/bookings?ticketPurchase=success&purchaseId=${encodeURIComponent(
        purchaseId,
      )}`;
      const cancelUrl = `${webBaseUrl}/bookings?ticketPurchase=cancel&purchaseId=${encodeURIComponent(
        purchaseId,
      )}`;

      try {
        const session = await createCheckoutSession({
          env,
          priceId: ticketType.stripePriceId,
          successUrl,
          cancelUrl,
          clientReferenceId: purchaseId,
          metadata: {
            purchaseId,
            organizationId,
            participantId: participant.id,
            ticketTypeId: ticketType.id,
          },
        });
        checkoutUrl = session.url;

        await database
          .update(dbSchema.ticketPurchase)
          .set({
            stripeCheckoutSessionId: session.id,
          })
          .where(
            and(
              eq(dbSchema.ticketPurchase.id, purchaseId),
              eq(dbSchema.ticketPurchase.status, TICKET_PURCHASE_STATUS.PENDING_PAYMENT),
            ),
          );
      } catch (error) {
        await database.delete(dbSchema.ticketPurchase).where(eq(dbSchema.ticketPurchase.id, purchaseId));
        if (error instanceof Error && error.message === 'STRIPE_NOT_CONFIGURED') {
          return c.json({ message: 'Stripe is not configured.' }, 422);
        }
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'Failed to create Stripe checkout session.';
        return c.json({ message }, 422);
      }
    }

    const rows = await database
      .select()
      .from(dbSchema.ticketPurchase)
      .where(eq(dbSchema.ticketPurchase.id, purchaseId))
      .limit(1);
    const purchase = rows[0];

    return c.json(
      {
        ...serializeTicketPurchase(purchase as Record<string, unknown> | undefined),
        checkoutUrl,
      },
      200,
    );
  });

  authRoutes.openapi(listMyTicketPurchasesRoute, async (c) => {
    const query = c.req.valid('query');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const participant = await findParticipantByUserAndOrganization({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!participant) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const filters = [
      eq(dbSchema.ticketPurchase.organizationId, organizationId),
      eq(dbSchema.ticketPurchase.participantId, participant.id),
    ];
    if (query.status) {
      filters.push(eq(dbSchema.ticketPurchase.status, query.status));
    }

    const rows = await database
      .select()
      .from(dbSchema.ticketPurchase)
      .where(and(...filters))
      .orderBy(desc(dbSchema.ticketPurchase.createdAt));

    return c.json(rows.map((row: any) => serializeTicketPurchase(row)), 200);
  });

  authRoutes.openapi(listTicketPurchasesRoute, async (c) => {
    const query = c.req.valid('query');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const filters = [eq(dbSchema.ticketPurchase.organizationId, organizationId)];
    if (query.participantId) {
      filters.push(eq(dbSchema.ticketPurchase.participantId, query.participantId));
    }
    if (query.paymentMethod) {
      filters.push(eq(dbSchema.ticketPurchase.paymentMethod, query.paymentMethod));
    }
    if (query.status) {
      filters.push(eq(dbSchema.ticketPurchase.status, query.status));
    }

    const rows = await database
      .select()
      .from(dbSchema.ticketPurchase)
      .where(and(...filters))
      .orderBy(desc(dbSchema.ticketPurchase.createdAt));

    return c.json(rows.map((row: any) => serializeTicketPurchase(row)), 200);
  });

  authRoutes.openapi(approveTicketPurchaseRoute, async (c) => {
    const body = c.req.valid('json');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const purchaseRows = await database
      .select({
        id: dbSchema.ticketPurchase.id,
        organizationId: dbSchema.ticketPurchase.organizationId,
      })
      .from(dbSchema.ticketPurchase)
      .where(eq(dbSchema.ticketPurchase.id, body.purchaseId))
      .limit(1);
    const purchase = purchaseRows[0];
    if (!purchase) {
      return c.json({ message: 'Ticket purchase not found.' }, 404);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId: purchase.organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const result = await approveTicketPurchaseWithIssue({
      purchaseId: body.purchaseId,
      actorUserId: identity.userId,
      actorReason: 'purchase-approved-by-staff',
    });
    if (result.kind === 'not_found') {
      return c.json({ message: 'Ticket purchase not found.' }, 404);
    }
    if (result.kind === 'ticket_type_not_found') {
      return c.json({ message: 'Ticket type not found.' }, 404);
    }
    if (result.kind === 'already_approved' || result.kind === 'invalid_status') {
      return c.json({ message: 'Only pending approval purchase can be approved.' }, 409);
    }

    return c.json(
      {
        purchase: result.purchase,
        ticketPack: result.ticketPack,
      },
      200,
    );
  });

  authRoutes.openapi(rejectTicketPurchaseRoute, async (c) => {
    const body = c.req.valid('json');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const purchaseRows = await database
      .select({
        id: dbSchema.ticketPurchase.id,
        organizationId: dbSchema.ticketPurchase.organizationId,
        status: dbSchema.ticketPurchase.status,
      })
      .from(dbSchema.ticketPurchase)
      .where(eq(dbSchema.ticketPurchase.id, body.purchaseId))
      .limit(1);
    const purchase = purchaseRows[0];
    if (!purchase) {
      return c.json({ message: 'Ticket purchase not found.' }, 404);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId: purchase.organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    if (purchase.status !== TICKET_PURCHASE_STATUS.PENDING_APPROVAL) {
      return c.json({ message: 'Only pending approval purchase can be rejected.' }, 409);
    }

    const updatedRows = await database
      .update(dbSchema.ticketPurchase)
      .set({
        status: TICKET_PURCHASE_STATUS.REJECTED,
        rejectedByUserId: identity.userId,
        rejectedAt: new Date(),
        rejectReason: body.reason ?? null,
      })
      .where(
        and(
          eq(dbSchema.ticketPurchase.id, purchase.id),
          eq(dbSchema.ticketPurchase.status, TICKET_PURCHASE_STATUS.PENDING_APPROVAL),
        ),
      )
      .returning({
        id: dbSchema.ticketPurchase.id,
      });
    if (!updatedRows[0]) {
      return c.json({ message: 'Only pending approval purchase can be rejected.' }, 409);
    }

    const rows = await database
      .select()
      .from(dbSchema.ticketPurchase)
      .where(eq(dbSchema.ticketPurchase.id, purchase.id))
      .limit(1);
    return c.json(serializeTicketPurchase(rows[0] as Record<string, unknown> | undefined), 200);
  });

  authRoutes.openapi(cancelTicketPurchaseRoute, async (c) => {
    const body = c.req.valid('json');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const purchaseRows = await database
      .select({
        id: dbSchema.ticketPurchase.id,
        organizationId: dbSchema.ticketPurchase.organizationId,
        participantId: dbSchema.ticketPurchase.participantId,
        status: dbSchema.ticketPurchase.status,
      })
      .from(dbSchema.ticketPurchase)
      .where(eq(dbSchema.ticketPurchase.id, body.purchaseId))
      .limit(1);
    const purchase = purchaseRows[0];
    if (!purchase) {
      return c.json({ message: 'Ticket purchase not found.' }, 404);
    }

    const participant = await findParticipantByUserAndOrganization({
      database,
      organizationId: purchase.organizationId,
      userId: identity.userId,
    });
    if (!participant || participant.id !== purchase.participantId) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    if (
      purchase.status !== TICKET_PURCHASE_STATUS.PENDING_PAYMENT &&
      purchase.status !== TICKET_PURCHASE_STATUS.PENDING_APPROVAL
    ) {
      return c.json({ message: 'Purchase cannot be canceled.' }, 409);
    }

    await database
      .update(dbSchema.ticketPurchase)
      .set({
        status: TICKET_PURCHASE_STATUS.CANCELLED_BY_PARTICIPANT,
      })
      .where(eq(dbSchema.ticketPurchase.id, purchase.id));

    const rows = await database
      .select()
      .from(dbSchema.ticketPurchase)
      .where(eq(dbSchema.ticketPurchase.id, purchase.id))
      .limit(1);
    return c.json(serializeTicketPurchase(rows[0] as Record<string, unknown> | undefined), 200);
  });

  authRoutes.openapi(grantTicketPackRoute, async (c) => {
    const body = c.req.valid('json');
    const headers = c.req.raw.headers;
    const identity = await requireIdentity(headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const hasAccess = await hasAdminOrOwnerAccess({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!hasAccess) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const participantRows = await database
      .select({
        id: dbSchema.participant.id,
      })
      .from(dbSchema.participant)
      .where(
        and(
          eq(dbSchema.participant.id, body.participantId),
          eq(dbSchema.participant.organizationId, organizationId),
        ),
      )
      .limit(1);
    const participant = participantRows[0];
    if (!participant) {
      return c.json({ message: 'Participant not found.' }, 404);
    }

    const ticketTypeRows = await database
      .select({
        id: dbSchema.ticketType.id,
        totalCount: dbSchema.ticketType.totalCount,
        expiresInDays: dbSchema.ticketType.expiresInDays,
      })
      .from(dbSchema.ticketType)
      .where(
        and(
          eq(dbSchema.ticketType.id, body.ticketTypeId),
          eq(dbSchema.ticketType.organizationId, organizationId),
        ),
      )
      .limit(1);
    const ticketType = ticketTypeRows[0];
    if (!ticketType) {
      return c.json({ message: 'Ticket type not found.' }, 404);
    }

    const count = body.count ?? ticketType.totalCount;
    const expiresAt = resolveEndDate(ticketType.expiresInDays, body.expiresAt);
    if (body.expiresAt && !expiresAt) {
      return c.json({ message: 'Invalid expiresAt.' }, 422);
    }

    const issued = await issueTicketPackWithLedger({
      organizationId,
      participantId: participant.id,
      ticketTypeId: ticketType.id,
      count,
      expiresAt,
      actorUserId: identity.userId,
      reason: 'staff-grant',
    });
    return c.json(issued.ticketPack, 200);
  });

  authRoutes.openapi(listMyTicketPacksRoute, async (c) => {
    const query = c.req.valid('query');
    const identity = await requireIdentity(c.req.raw.headers);
    if (!identity) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
    if (!organizationId) {
      return c.json({ message: 'organizationId is required.' }, 422);
    }

    const participant = await findParticipantByUserAndOrganization({
      database,
      organizationId,
      userId: identity.userId,
    });
    if (!participant) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const now = new Date();
    await database
      .update(dbSchema.ticketPack)
      .set({
        status: TICKET_PACK_STATUS.EXPIRED,
      })
      .where(
        and(
          eq(dbSchema.ticketPack.organizationId, organizationId),
          eq(dbSchema.ticketPack.participantId, participant.id),
          eq(dbSchema.ticketPack.status, TICKET_PACK_STATUS.ACTIVE),
          lte(dbSchema.ticketPack.expiresAt, now),
        ),
      );

    const rows = await database
      .select()
      .from(dbSchema.ticketPack)
      .where(
        and(
          eq(dbSchema.ticketPack.organizationId, organizationId),
          eq(dbSchema.ticketPack.participantId, participant.id),
        ),
      )
      .orderBy(asc(dbSchema.ticketPack.createdAt));

    return c.json(rows.map((row: any) => serializeTicketPack(row)), 200);
  });
};
