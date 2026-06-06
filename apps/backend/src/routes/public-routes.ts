import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { resolveOrganizationStoreContext } from '../domain/booking/authorization.js';
import { writeBookingAuditLog } from '../domain/booking/audit.js';
import {
  BOOKING_AUDIT_ACTION,
  BOOKING_SOURCE,
  BOOKING_STATUS,
  DEFAULT_CANCELLATION_DEADLINE_MINUTES,
  PUBLIC_SITE_STATUS,
  SERVICE_PUBLIC_STATUS,
  SLOT_PUBLIC_STATUS,
  SLOT_STATUS,
} from '../domain/booking/constants.js';
import { type AuthRuntimeDatabase, type AuthRuntimeEnv } from '../auth-runtime.js';
import * as dbSchema from '../infra/db/schema.js';
import { runDatabaseTransactionOrThrow } from '../infra/db/transaction.js';
import {
  cancelPendingBookingReminderOutboxes,
  enqueueBookingCustomerNotificationOutbox,
  enqueueBookingOperationalNotificationOutbox,
  enqueueBookingRemindersForBooking,
} from '../features/booking/booking.notifications.js';
import {
  parseTicketServiceIds,
  resolveTicketServiceScope,
  type TicketServiceScope,
} from '../shared/serializers.js';
import {
  insertFormSubmissions,
  resolveRequiredForms,
  validateFormSubmissions,
} from '../features/forms/form.logic.js';

const publicTicketTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  totalCount: z.number(),
  expiresInDays: z.number().nullable().optional(),
  serviceScope: z.enum(['all', 'specific']),
  serviceIds: z.array(z.string()),
  serviceNames: z.array(z.string()),
  href: z.string(),
});

const publicFormOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});

const publicFormFieldSchema = z.object({
  fieldKey: z.string(),
  fieldType: z.enum(['text', 'textarea', 'radio', 'checkbox', 'select', 'date', 'consent']),
  label: z.string(),
  description: z.string().nullable(),
  placeholder: z.string().nullable(),
  required: z.boolean(),
  options: z.array(publicFormOptionSchema),
  sortOrder: z.number(),
});

const publicRequiredFormSchema = z.object({
  formTemplateId: z.string(),
  formTemplateVersionId: z.string(),
  formType: z.enum(['reservation_input', 'pre_survey', 'consent']),
  name: z.string(),
  description: z.string().nullable(),
  versionNumber: z.number(),
  fields: z.array(publicFormFieldSchema),
});

const publicRequiredFormsSchema = z.object({
  formContextHash: z.string(),
  forms: z.array(publicRequiredFormSchema),
});

const publicEventSchema = z.object({
  organizationId: z.string(),
  organizationSlug: z.string(),
  storeId: z.string(),
  storeSlug: z.string(),
  serviceId: z.string(),
  serviceName: z.string(),
  serviceDescription: z.string().nullable().optional(),
  serviceImageUrl: z.string().nullable().optional(),
  serviceKind: z.enum(['single', 'recurring']),
  bookingPolicy: z.enum(['instant', 'approval']),
  requiresTicket: z.boolean(),
  slotId: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  slotStatus: z.enum([SLOT_STATUS.OPEN, SLOT_STATUS.CANCELED, SLOT_STATUS.COMPLETED]),
  slotPublicStatus: z.enum([
    SLOT_PUBLIC_STATUS.PUBLIC,
    SLOT_PUBLIC_STATUS.PRIVATE,
    SLOT_PUBLIC_STATUS.SUSPENDED,
  ]),
  capacity: z.number(),
  reservedCount: z.number(),
  remainingCount: z.number(),
  bookingOpenAt: z.string(),
  bookingCloseAt: z.string(),
  isBookable: z.boolean(),
  staffLabel: z.string().nullable().optional(),
  locationLabel: z.string().nullable().optional(),
});

const publicEventsPageSchema = z.object({
  events: z.array(publicEventSchema),
  ticketTypes: z.array(publicTicketTypeSchema),
});

const publicEventDetailSchema = publicEventSchema.extend({
  ticketTypes: z.array(publicTicketTypeSchema),
});

const publicSiteProfileSchema = z.object({
  organizationId: z.string(),
  organizationSlug: z.string(),
  organizationName: z.string(),
  storeId: z.string(),
  storeSlug: z.string(),
  storeName: z.string(),
  siteName: z.string(),
  description: z.string().nullable(),
  descriptionFormat: z.enum(['plain_text', 'limited_html']),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  businessHours: z.string().nullable(),
  imageUrl: z.string().nullable(),
  status: z.enum([
    PUBLIC_SITE_STATUS.PUBLIC,
    PUBLIC_SITE_STATUS.PRIVATE,
    PUBLIC_SITE_STATUS.SUSPENDED,
  ]),
  acceptBookings: z.boolean(),
  noindex: z.boolean(),
});

const publicReservationPageSchema = z.object({
  id: z.string(),
  kind: z.literal('event'),
  title: z.string(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  href: z.string(),
  serviceId: z.string(),
  slotId: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  remainingCount: z.number(),
  capacity: z.number(),
  isBookable: z.boolean(),
  locationLabel: z.string().nullable().optional(),
});

const publicSitePageSchema = z.object({
  site: publicSiteProfileSchema,
  bookingPages: z.array(publicReservationPageSchema),
  ticketTypes: z.array(publicTicketTypeSchema),
});

const publicEventRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
  storeSlug: z.string().min(1),
});

const getPublicSiteRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/site',
  tags: ['Public Site'],
  summary: 'Get public reservation site top page',
  request: {
    params: publicEventRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Public reservation site',
      content: {
        'application/json': {
          schema: publicSitePageSchema,
        },
      },
    },
    404: {
      description: 'Public organization or store not found',
    },
  },
});

const listPublicEventsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/events',
  tags: ['Public Events'],
  summary: 'List public events',
  request: {
    params: publicEventRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Public event list',
      content: {
        'application/json': {
          schema: publicEventsPageSchema,
        },
      },
    },
    404: {
      description: 'Public organization or store not found',
    },
  },
});

const publicEventDetailParamsSchema = publicEventRouteParamsSchema.extend({
  slotId: z.string().min(1),
});

const getPublicEventDetailRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/events/{slotId}',
  tags: ['Public Events'],
  summary: 'Get a public event detail by slot id',
  request: {
    params: publicEventDetailParamsSchema,
  },
  responses: {
    200: {
      description: 'Public event detail',
      content: {
        'application/json': {
          schema: publicEventDetailSchema,
        },
      },
    },
    404: {
      description: 'Public event not found',
    },
  },
});

const getRequiredFormsQuerySchema = z.object({
  serviceId: z.string().min(1).optional(),
  slotId: z.string().min(1).optional(),
});

const getRequiredFormsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/forms/required',
  tags: ['Public Forms'],
  summary: 'Get required forms for a public booking context',
  request: {
    params: publicEventRouteParamsSchema,
    query: getRequiredFormsQuerySchema,
  },
  responses: {
    200: {
      description: 'Required public booking forms',
      content: {
        'application/json': {
          schema: publicRequiredFormsSchema,
        },
      },
    },
    404: {
      description: 'Public organization, store, service, or slot not found',
    },
  },
});

const publicTicketTypeDetailParamsSchema = publicEventRouteParamsSchema.extend({
  ticketTypeId: z.string().min(1),
});

const getPublicTicketTypeDetailRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/ticket-types/{ticketTypeId}',
  tags: ['Public Tickets'],
  summary: 'Get a public ticket type detail by id',
  request: {
    params: publicTicketTypeDetailParamsSchema,
  },
  responses: {
    200: {
      description: 'Public ticket type detail',
      content: {
        'application/json': {
          schema: publicTicketTypeSchema,
        },
      },
    },
    404: {
      description: 'Public ticket type not found',
    },
  },
});

const publicBookingCompanionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  note: z.string().trim().max(500).nullable().optional(),
});

const publicBookingCustomerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(320),
  phone: z.string().trim().max(80).optional(),
});

const publicFormAnswerSchema = z.object({
  fieldKey: z.string().trim().min(1).max(120),
  value: z.unknown(),
});

const publicFormSubmissionSchema = z.object({
  formTemplateId: z.string().trim().min(1).max(120),
  formTemplateVersionId: z.string().trim().min(1).max(120),
  answers: z.array(publicFormAnswerSchema).max(100).optional(),
});

const createPublicBookingBodySchema = z.object({
  slotId: z.string().min(1),
  serviceId: z.string().min(1).optional(),
  customer: publicBookingCustomerSchema,
  participantsCount: z.int().min(1).max(20).default(1),
  companions: z.array(publicBookingCompanionSchema).max(19).optional(),
  note: z.string().trim().max(1000).optional(),
  formContextHash: z.string().min(1),
  formSubmissions: z.array(publicFormSubmissionSchema).max(10).optional(),
});

const publicBookingResponseSchema = z.object({
  bookingId: z.string(),
  bookingPublicId: z.string(),
  status: z.enum([BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.PENDING_APPROVAL]),
});

const publicCancelParamsSchema = publicEventRouteParamsSchema.extend({
  bookingPublicId: z.string().min(1),
});

const publicCancelBodySchema = z.object({
  token: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

const createPublicBookingRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/bookings',
  tags: ['Public Bookings'],
  summary: 'Create a guest booking from a public reservation site',
  request: {
    params: publicEventRouteParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createPublicBookingBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Public booking created',
      content: {
        'application/json': {
          schema: publicBookingResponseSchema,
        },
      },
    },
    404: { description: 'Public site or slot not found' },
    409: { description: 'Public booking conflict' },
  },
});

const cancelPublicBookingRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/bookings/{bookingPublicId}/cancel',
  tags: ['Public Bookings'],
  summary: 'Cancel a guest booking with a one-time token',
  request: {
    params: publicCancelParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: publicCancelBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Public booking canceled' },
    404: { description: 'Public booking not found' },
    409: { description: 'Public booking cannot be canceled' },
  },
});

const toIsoDate = (value: Date): string => value.toISOString();

type PublicTicketType = {
  id: string;
  name: string;
  totalCount: number;
  expiresInDays: number | null;
  serviceScope: TicketServiceScope;
  serviceIds: string[];
  serviceNames: string[];
  href: string;
};

type PublicTicketTypeRow = {
  id: string;
  name: string;
  serviceIdsJson: string | null;
  totalCount: number;
  expiresInDays: number | null;
};

type PublicEventQueryRow = {
  organizationId: string;
  serviceId: string;
  serviceName: string;
  serviceDescription: string | null;
  serviceImageUrl: string | null;
  serviceKind: 'single' | 'recurring';
  bookingPolicy: 'instant' | 'approval';
  requiresTicket: boolean;
  servicePublicStatus: string;
  slotId: string;
  startAt: Date;
  endAt: Date;
  slotStatus: string;
  slotPublicStatus: string;
  capacity: number;
  reservedCount: number;
  bookingOpenAt: Date;
  bookingCloseAt: Date;
  staffLabel: string | null;
  locationLabel: string | null;
};

type PublicContext = {
  error: null;
  organization: {
    id: string;
    slug: string;
    name: string;
    logo: string | null;
  };
  store: {
    id: string;
    slug: string;
    name: string;
  };
  siteSetting: {
    siteName: string | null;
    description: string | null;
    descriptionFormat: string;
    address: string | null;
    phone: string | null;
    businessHours: string | null;
    imageUrl: string | null;
    status: string;
    acceptBookings: boolean;
    noindex: boolean;
  };
};

const isBookableSlot = ({
  slotStatus,
  reservedCount,
  capacity,
  bookingOpenAt,
  bookingCloseAt,
  now,
}: {
  slotStatus: string;
  reservedCount: number;
  capacity: number;
  bookingOpenAt: Date;
  bookingCloseAt: Date;
  now: Date;
}) => {
  return (
    slotStatus === SLOT_STATUS.OPEN &&
    reservedCount < capacity &&
    bookingOpenAt.getTime() <= now.getTime() &&
    bookingCloseAt.getTime() >= now.getTime()
  );
};

const formatPublicEvent = (
  row: PublicEventQueryRow & {
    organizationSlug: string;
    storeId: string;
    storeSlug: string;
  },
  now: Date,
  acceptBookings = true,
) => {
  const remainingCount = Math.max(row.capacity - row.reservedCount, 0);
  return {
    organizationId: row.organizationId,
    organizationSlug: row.organizationSlug,
    storeId: row.storeId,
    storeSlug: row.storeSlug,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    serviceDescription: row.serviceDescription,
    serviceImageUrl: row.serviceImageUrl,
    serviceKind: row.serviceKind,
    bookingPolicy: row.bookingPolicy,
    requiresTicket: row.requiresTicket,
    slotId: row.slotId,
    startAt: toIsoDate(row.startAt),
    endAt: toIsoDate(row.endAt),
    slotStatus: row.slotStatus as 'open' | 'canceled' | 'completed',
    slotPublicStatus: row.slotPublicStatus as 'public' | 'private' | 'suspended',
    capacity: row.capacity,
    reservedCount: row.reservedCount,
    remainingCount,
    bookingOpenAt: toIsoDate(row.bookingOpenAt),
    bookingCloseAt: toIsoDate(row.bookingCloseAt),
    isBookable:
      acceptBookings &&
      row.servicePublicStatus === SERVICE_PUBLIC_STATUS.PUBLIC &&
      row.slotPublicStatus === SLOT_PUBLIC_STATUS.PUBLIC &&
      isBookableSlot({
        slotStatus: row.slotStatus,
        reservedCount: row.reservedCount,
        capacity: row.capacity,
        bookingOpenAt: row.bookingOpenAt,
        bookingCloseAt: row.bookingCloseAt,
        now,
      }),
    staffLabel: row.staffLabel,
    locationLabel: row.locationLabel,
  };
};

const listPublicEventRows = async ({
  database,
  publicContext,
  now,
  limit,
}: {
  database: AuthRuntimeDatabase;
  publicContext: PublicContext;
  now: Date;
  limit: number;
}): Promise<PublicEventQueryRow[]> => {
  return (await database
    .select({
      organizationId: dbSchema.slot.organizationId,
      serviceId: dbSchema.service.id,
      serviceName: dbSchema.service.name,
      serviceDescription: dbSchema.service.description,
      serviceImageUrl: dbSchema.service.imageUrl,
      serviceKind: dbSchema.service.kind,
      bookingPolicy: dbSchema.service.bookingPolicy,
      requiresTicket: dbSchema.service.requiresTicket,
      servicePublicStatus: dbSchema.service.publicStatus,
      slotId: dbSchema.slot.id,
      startAt: dbSchema.slot.startAt,
      endAt: dbSchema.slot.endAt,
      slotStatus: dbSchema.slot.status,
      slotPublicStatus: dbSchema.slot.publicStatus,
      capacity: dbSchema.slot.capacity,
      reservedCount: dbSchema.slot.reservedCount,
      bookingOpenAt: dbSchema.slot.bookingOpenAt,
      bookingCloseAt: dbSchema.slot.bookingCloseAt,
      staffLabel: dbSchema.slot.staffLabel,
      locationLabel: dbSchema.slot.locationLabel,
    })
    .from(dbSchema.slot)
    .innerJoin(dbSchema.service, eq(dbSchema.service.id, dbSchema.slot.serviceId))
    .where(
      and(
        eq(dbSchema.slot.organizationId, publicContext.organization.id),
        eq(dbSchema.slot.storeId, publicContext.store.id),
        eq(dbSchema.service.isActive, true),
        inArray(dbSchema.service.publicStatus, [
          SERVICE_PUBLIC_STATUS.PUBLIC,
          SERVICE_PUBLIC_STATUS.SUSPENDED,
        ]),
        inArray(dbSchema.slot.publicStatus, [
          SLOT_PUBLIC_STATUS.PUBLIC,
          SLOT_PUBLIC_STATUS.SUSPENDED,
        ]),
        gte(dbSchema.slot.startAt, now),
      ),
    )
    .orderBy(asc(dbSchema.slot.startAt))
    .limit(limit)) as PublicEventQueryRow[];
};

const formatPublicReservationPage = (
  event: ReturnType<typeof formatPublicEvent>,
  publicContext: PublicContext,
) => ({
  id: event.slotId,
  kind: 'event' as const,
  title: event.serviceName,
  description: event.serviceDescription,
  imageUrl: event.serviceImageUrl,
  href: `/${publicContext.organization.slug}/${publicContext.store.slug}/events/${event.slotId}`,
  serviceId: event.serviceId,
  slotId: event.slotId,
  startAt: event.startAt,
  endAt: event.endAt,
  remainingCount: event.remainingCount,
  capacity: event.capacity,
  isBookable: event.isBookable,
  locationLabel: event.locationLabel,
});

const buildPublicTicketTypeHref = ({
  orgSlug,
  storeSlug,
  ticketTypeId,
}: {
  orgSlug: string;
  storeSlug: string;
  ticketTypeId: string;
}): string =>
  `/${encodeURIComponent(orgSlug)}/${encodeURIComponent(storeSlug)}/tickets/${encodeURIComponent(
    ticketTypeId,
  )}`;

const readPublicSiteProfile = async ({ publicContext }: { publicContext: PublicContext }) => {
  const setting = publicContext.siteSetting;

  return {
    organizationId: publicContext.organization.id,
    organizationSlug: publicContext.organization.slug,
    organizationName: publicContext.organization.name,
    storeId: publicContext.store.id,
    storeSlug: publicContext.store.slug,
    storeName: publicContext.store.name,
    siteName:
      setting?.siteName?.trim() || publicContext.store.name || publicContext.organization.name,
    description: setting?.description ?? null,
    descriptionFormat:
      setting?.descriptionFormat === 'limited_html' ? 'limited_html' : 'plain_text',
    address: setting?.address ?? null,
    phone: setting?.phone ?? null,
    businessHours: setting?.businessHours ?? null,
    imageUrl: setting?.imageUrl ?? publicContext.organization.logo ?? null,
    status: setting.status as 'public' | 'private' | 'suspended',
    acceptBookings: setting.acceptBookings,
    noindex: setting.noindex,
  };
};

const formatPublicTicketTypes = async ({
  database,
  organizationId,
  storeId,
  orgSlug,
  storeSlug,
  rows,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
  orgSlug: string;
  storeSlug: string;
  rows: PublicTicketTypeRow[];
}): Promise<PublicTicketType[]> => {
  const serviceIds = Array.from(
    new Set(rows.flatMap((row) => parseTicketServiceIds(row.serviceIdsJson))),
  );
  const serviceRows: Array<{ id: string; name: string }> =
    serviceIds.length > 0
      ? ((await database
          .select({
            id: dbSchema.service.id,
            name: dbSchema.service.name,
          })
          .from(dbSchema.service)
          .where(
            and(
              eq(dbSchema.service.organizationId, organizationId),
              eq(dbSchema.service.storeId, storeId),
              inArray(dbSchema.service.id, serviceIds),
            ),
          )) as Array<{ id: string; name: string }>)
      : [];
  const serviceNameById = new Map(serviceRows.map((service) => [service.id, service.name]));

  return rows.map((row) => {
    const ticketServiceIds = parseTicketServiceIds(row.serviceIdsJson);
    return {
      id: row.id,
      name: row.name,
      totalCount: row.totalCount,
      expiresInDays: row.expiresInDays,
      serviceScope: resolveTicketServiceScope(ticketServiceIds),
      serviceIds: ticketServiceIds,
      serviceNames: ticketServiceIds
        .map((serviceId) => serviceNameById.get(serviceId))
        .filter((serviceName): serviceName is string => typeof serviceName === 'string'),
      href: buildPublicTicketTypeHref({
        orgSlug,
        storeSlug,
        ticketTypeId: row.id,
      }),
    };
  });
};

const listPublicTicketTypes = async ({
  database,
  publicContext,
}: {
  database: AuthRuntimeDatabase;
  publicContext: PublicContext;
}): Promise<PublicTicketType[]> => {
  const rows = (await database
    .select({
      id: dbSchema.ticketType.id,
      name: dbSchema.ticketType.name,
      serviceIdsJson: dbSchema.ticketType.serviceIdsJson,
      totalCount: dbSchema.ticketType.totalCount,
      expiresInDays: dbSchema.ticketType.expiresInDays,
    })
    .from(dbSchema.ticketType)
    .where(
      and(
        eq(dbSchema.ticketType.organizationId, publicContext.organization.id),
        eq(dbSchema.ticketType.storeId, publicContext.store.id),
        eq(dbSchema.ticketType.isActive, true),
        eq(dbSchema.ticketType.isForSale, true),
      ),
    )
    .orderBy(desc(dbSchema.ticketType.createdAt))) as PublicTicketTypeRow[];

  return formatPublicTicketTypes({
    database,
    organizationId: publicContext.organization.id,
    storeId: publicContext.store.id,
    orgSlug: publicContext.organization.slug,
    storeSlug: publicContext.store.slug,
    rows,
  });
};

const getPublicTicketType = async ({
  database,
  publicContext,
  ticketTypeId,
}: {
  database: AuthRuntimeDatabase;
  publicContext: PublicContext;
  ticketTypeId: string;
}): Promise<PublicTicketType | null> => {
  const rows = (await database
    .select({
      id: dbSchema.ticketType.id,
      name: dbSchema.ticketType.name,
      serviceIdsJson: dbSchema.ticketType.serviceIdsJson,
      totalCount: dbSchema.ticketType.totalCount,
      expiresInDays: dbSchema.ticketType.expiresInDays,
    })
    .from(dbSchema.ticketType)
    .where(
      and(
        eq(dbSchema.ticketType.id, ticketTypeId),
        eq(dbSchema.ticketType.organizationId, publicContext.organization.id),
        eq(dbSchema.ticketType.storeId, publicContext.store.id),
        eq(dbSchema.ticketType.isActive, true),
        eq(dbSchema.ticketType.isForSale, true),
      ),
    )
    .limit(1)) as PublicTicketTypeRow[];

  const [ticketType] = await formatPublicTicketTypes({
    database,
    organizationId: publicContext.organization.id,
    storeId: publicContext.store.id,
    orgSlug: publicContext.organization.slug,
    storeSlug: publicContext.store.slug,
    rows,
  });
  return ticketType ?? null;
};

const resolvePublicOrganizationStore = async ({
  database,
  orgSlug,
  storeSlug,
}: {
  database: AuthRuntimeDatabase;
  orgSlug: string;
  storeSlug: string;
}) => {
  const rows = await database
    .select({
      id: dbSchema.organization.id,
      slug: dbSchema.organization.slug,
      name: dbSchema.organization.name,
      logo: dbSchema.organization.logo,
    })
    .from(dbSchema.organization)
    .where(eq(dbSchema.organization.slug, orgSlug))
    .limit(1);
  const organization = rows[0];
  if (!organization) {
    return {
      error: {
        status: 404 as const,
        message: 'Public events organization was not found.',
      },
      organization: null,
      store: null,
    };
  }

  const context = await resolveOrganizationStoreContext({
    database,
    organizationSlug: orgSlug,
    storeSlug,
  });
  if (!context) {
    return {
      error: {
        status: 404 as const,
        message: 'Public events store was not found.',
      },
      organization: null,
      store: null,
    };
  }

  const settingRows = await database
    .select({
      siteName: dbSchema.publicSiteSetting.siteName,
      description: dbSchema.publicSiteSetting.description,
      descriptionFormat: dbSchema.publicSiteSetting.descriptionFormat,
      address: dbSchema.publicSiteSetting.address,
      phone: dbSchema.publicSiteSetting.phone,
      businessHours: dbSchema.publicSiteSetting.businessHours,
      imageUrl: dbSchema.publicSiteSetting.imageUrl,
      status: dbSchema.publicSiteSetting.status,
      acceptBookings: dbSchema.publicSiteSetting.acceptBookings,
      noindex: dbSchema.publicSiteSetting.noindex,
    })
    .from(dbSchema.publicSiteSetting)
    .where(
      and(
        eq(dbSchema.publicSiteSetting.organizationId, context.organizationId),
        eq(dbSchema.publicSiteSetting.storeId, context.storeId),
      ),
    )
    .limit(1);
  const siteSetting = settingRows[0] ?? null;
  if (!siteSetting || siteSetting.status !== PUBLIC_SITE_STATUS.PUBLIC) {
    return {
      error: {
        status: 404 as const,
        message: 'Public reservation site was not found.',
      },
      organization: null,
      store: null,
    };
  }

  return {
    error: null,
    organization: {
      id: context.organizationId,
      slug: context.organizationSlug,
      name: context.organizationName,
      logo: organization.logo,
    },
    store: {
      id: context.storeId,
      slug: context.storeSlug,
      name: context.storeName,
    },
    siteSetting,
  };
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const createRandomHex = (byteLength: number): string => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};

const createBookingPublicId = (): string => `bk_${createRandomHex(12)}`;

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
};

const normalizeOptionalText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const createPublicCancelUrl = ({
  env,
  requestUrl,
  publicContext,
  bookingPublicId,
  token,
}: {
  env: AuthRuntimeEnv;
  requestUrl: string;
  publicContext: PublicContext;
  bookingPublicId: string;
  token: string;
}): string => {
  const base = env.WEB_BASE_URL || new URL(requestUrl).origin;
  const path = `/${encodeURIComponent(publicContext.organization.slug)}/${encodeURIComponent(
    publicContext.store.slug,
  )}/bookings/${encodeURIComponent(bookingPublicId)}/cancel`;
  const url = new URL(path, base);
  url.searchParams.set('token', token);
  return url.toString();
};

const insertPublicBookingDetails = async ({
  database,
  bookingId,
  companions,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  companions: z.infer<typeof publicBookingCompanionSchema>[] | undefined;
}) => {
  const normalizedCompanions =
    companions
      ?.map((companion) => ({
        name: companion.name.trim(),
        note: normalizeOptionalText(companion.note),
      }))
      .filter((companion) => companion.name.length > 0) ?? [];

  if (normalizedCompanions.length > 0) {
    await database.insert(dbSchema.bookingCompanion).values(
      normalizedCompanions.map((companion) => ({
        id: crypto.randomUUID(),
        bookingId,
        name: companion.name,
        note: companion.note,
      })),
    );
  }
};

const createPublicCancelToken = async ({
  database,
  bookingId,
  emailSnapshot,
  now,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  emailSnapshot: string;
  now: Date;
}) => {
  const token = createRandomHex(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await database.insert(dbSchema.bookingPublicActionToken).values({
    id: crypto.randomUUID(),
    bookingId,
    purpose: 'cancel',
    tokenHash,
    emailSnapshot,
    expiresAt,
  });
  return token;
};

const reservePublicSlotCapacity = async ({
  database,
  slotId,
  participantsCount,
  now,
}: {
  database: AuthRuntimeDatabase;
  slotId: string;
  participantsCount: number;
  now: Date;
}) => {
  const rows = await database
    .update(dbSchema.slot)
    .set({
      reservedCount: sql`${dbSchema.slot.reservedCount} + ${participantsCount}`,
    })
    .where(
      and(
        eq(dbSchema.slot.id, slotId),
        eq(dbSchema.slot.status, SLOT_STATUS.OPEN),
        lte(dbSchema.slot.bookingOpenAt, now),
        gte(dbSchema.slot.bookingCloseAt, now),
        sql`${dbSchema.slot.reservedCount} + ${participantsCount} <= ${dbSchema.slot.capacity}`,
      ),
    )
    .returning({ id: dbSchema.slot.id });
  return rows.length > 0;
};

const resolvePublicFormsContext = async ({
  database,
  publicContext,
  serviceId,
  slotId,
}: {
  database: AuthRuntimeDatabase;
  publicContext: PublicContext;
  serviceId?: string | null;
  slotId?: string | null;
}): Promise<{ serviceId?: string; slotId?: string } | null> => {
  if (slotId) {
    const rows = await database
      .select({
        slotId: dbSchema.slot.id,
        serviceId: dbSchema.slot.serviceId,
        serviceIsActive: dbSchema.service.isActive,
        servicePublicStatus: dbSchema.service.publicStatus,
        slotPublicStatus: dbSchema.slot.publicStatus,
      })
      .from(dbSchema.slot)
      .innerJoin(dbSchema.service, eq(dbSchema.service.id, dbSchema.slot.serviceId))
      .where(
        and(
          eq(dbSchema.slot.id, slotId),
          eq(dbSchema.slot.organizationId, publicContext.organization.id),
          eq(dbSchema.slot.storeId, publicContext.store.id),
        ),
      )
      .limit(1);
    const slot = rows[0] ?? null;
    if (
      !slot ||
      !slot.serviceIsActive ||
      slot.servicePublicStatus === SERVICE_PUBLIC_STATUS.PRIVATE ||
      slot.slotPublicStatus === SLOT_PUBLIC_STATUS.PRIVATE
    ) {
      return null;
    }
    if (serviceId && serviceId !== slot.serviceId) {
      return null;
    }
    return { serviceId: slot.serviceId, slotId: slot.slotId };
  }

  if (serviceId) {
    const rows = await database
      .select({
        serviceId: dbSchema.service.id,
        isActive: dbSchema.service.isActive,
        publicStatus: dbSchema.service.publicStatus,
      })
      .from(dbSchema.service)
      .where(
        and(
          eq(dbSchema.service.id, serviceId),
          eq(dbSchema.service.organizationId, publicContext.organization.id),
          eq(dbSchema.service.storeId, publicContext.store.id),
        ),
      )
      .limit(1);
    const service = rows[0] ?? null;
    if (!service || !service.isActive || service.publicStatus === SERVICE_PUBLIC_STATUS.PRIVATE) {
      return null;
    }
    return { serviceId: service.serviceId };
  }

  return {};
};

export const createPublicRoutes = ({
  database,
  env,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
}) => {
  const publicRoutes = new OpenAPIHono();

  publicRoutes.openapi(getPublicSiteRoute, async (c) => {
    const { orgSlug, storeSlug } = c.req.valid('param');
    const publicContext = await resolvePublicOrganizationStore({
      database,
      orgSlug,
      storeSlug,
    });
    if (publicContext.error) {
      return c.json({ message: publicContext.error.message }, publicContext.error.status);
    }

    const now = new Date();
    const [site, rows, ticketTypes] = await Promise.all([
      readPublicSiteProfile({ publicContext }),
      listPublicEventRows({
        database,
        publicContext,
        now,
        limit: 12,
      }),
      listPublicTicketTypes({
        database,
        publicContext,
      }),
    ]);
    const events = rows.map((row) =>
      formatPublicEvent(
        {
          ...row,
          organizationSlug: publicContext.organization.slug,
          storeId: publicContext.store.id,
          storeSlug: publicContext.store.slug,
        },
        now,
        publicContext.siteSetting.acceptBookings,
      ),
    );

    return c.json(
      {
        site,
        bookingPages: events.map((event) => formatPublicReservationPage(event, publicContext)),
        ticketTypes,
      },
      200,
    );
  });

  publicRoutes.openapi(listPublicEventsRoute, async (c) => {
    const { orgSlug, storeSlug } = c.req.valid('param');
    const publicContext = await resolvePublicOrganizationStore({
      database,
      orgSlug,
      storeSlug,
    });
    if (publicContext.error) {
      return c.json({ message: publicContext.error.message }, publicContext.error.status);
    }

    const now = new Date();
    const [rows, ticketTypes] = await Promise.all([
      listPublicEventRows({
        database,
        publicContext,
        now,
        limit: 300,
      }),
      listPublicTicketTypes({
        database,
        publicContext,
      }),
    ]);

    return c.json(
      {
        events: rows.map((row: (typeof rows)[number]) =>
          formatPublicEvent(
            {
              ...row,
              organizationSlug: publicContext.organization.slug,
              storeId: publicContext.store.id,
              storeSlug: publicContext.store.slug,
            },
            now,
            publicContext.siteSetting.acceptBookings,
          ),
        ),
        ticketTypes,
      },
      200,
    );
  });

  publicRoutes.openapi(getPublicEventDetailRoute, async (c) => {
    const { slotId, orgSlug, storeSlug } = c.req.valid('param');
    const publicContext = await resolvePublicOrganizationStore({
      database,
      orgSlug,
      storeSlug,
    });
    if (publicContext.error) {
      return c.json({ message: publicContext.error.message }, publicContext.error.status);
    }

    const rows = await database
      .select({
        organizationId: dbSchema.slot.organizationId,
        serviceId: dbSchema.service.id,
        serviceName: dbSchema.service.name,
        serviceDescription: dbSchema.service.description,
        serviceImageUrl: dbSchema.service.imageUrl,
        serviceKind: dbSchema.service.kind,
        bookingPolicy: dbSchema.service.bookingPolicy,
        requiresTicket: dbSchema.service.requiresTicket,
        servicePublicStatus: dbSchema.service.publicStatus,
        slotId: dbSchema.slot.id,
        startAt: dbSchema.slot.startAt,
        endAt: dbSchema.slot.endAt,
        slotStatus: dbSchema.slot.status,
        slotPublicStatus: dbSchema.slot.publicStatus,
        capacity: dbSchema.slot.capacity,
        reservedCount: dbSchema.slot.reservedCount,
        bookingOpenAt: dbSchema.slot.bookingOpenAt,
        bookingCloseAt: dbSchema.slot.bookingCloseAt,
        staffLabel: dbSchema.slot.staffLabel,
        locationLabel: dbSchema.slot.locationLabel,
      })
      .from(dbSchema.slot)
      .innerJoin(dbSchema.service, eq(dbSchema.service.id, dbSchema.slot.serviceId))
      .where(
        and(
          eq(dbSchema.slot.organizationId, publicContext.organization.id),
          eq(dbSchema.slot.storeId, publicContext.store.id),
          eq(dbSchema.slot.id, slotId),
          eq(dbSchema.service.isActive, true),
          inArray(dbSchema.service.publicStatus, [
            SERVICE_PUBLIC_STATUS.PUBLIC,
            SERVICE_PUBLIC_STATUS.SUSPENDED,
          ]),
          inArray(dbSchema.slot.publicStatus, [
            SLOT_PUBLIC_STATUS.PUBLIC,
            SLOT_PUBLIC_STATUS.SUSPENDED,
          ]),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return c.json({ message: 'Public event not found.' }, 404);
    }

    const ticketTypes = await listPublicTicketTypes({
      database,
      publicContext,
    });

    return c.json(
      {
        ...formatPublicEvent(
          {
            ...row,
            organizationSlug: publicContext.organization.slug,
            storeId: publicContext.store.id,
            storeSlug: publicContext.store.slug,
          },
          new Date(),
          publicContext.siteSetting.acceptBookings,
        ),
        ticketTypes,
      },
      200,
    );
  });

  publicRoutes.openapi(getRequiredFormsRoute, async (c) => {
    const { orgSlug, storeSlug } = c.req.valid('param');
    const { serviceId, slotId } = c.req.valid('query');
    const publicContext = await resolvePublicOrganizationStore({
      database,
      orgSlug,
      storeSlug,
    });
    if (publicContext.error) {
      return c.json({ message: publicContext.error.message }, publicContext.error.status);
    }

    const formsContext = await resolvePublicFormsContext({
      database,
      publicContext,
      serviceId,
      slotId,
    });
    if (!formsContext) {
      return c.json({ message: 'Public forms context was not found.' }, 404);
    }

    const requiredForms = await resolveRequiredForms({
      database,
      organizationId: publicContext.organization.id,
      storeId: publicContext.store.id,
      serviceId: formsContext.serviceId,
      slotId: formsContext.slotId,
    });
    return c.json(requiredForms, 200);
  });

  publicRoutes.openapi(getPublicTicketTypeDetailRoute, async (c) => {
    const { ticketTypeId, orgSlug, storeSlug } = c.req.valid('param');
    const publicContext = await resolvePublicOrganizationStore({
      database,
      orgSlug,
      storeSlug,
    });
    if (publicContext.error) {
      return c.json({ message: publicContext.error.message }, publicContext.error.status);
    }

    const ticketType = await getPublicTicketType({
      database,
      publicContext,
      ticketTypeId,
    });
    if (!ticketType) {
      return c.json({ message: 'Public ticket type not found.' }, 404);
    }

    return c.json(ticketType, 200);
  });

  publicRoutes.openapi(createPublicBookingRoute, async (c) => {
    const { orgSlug, storeSlug } = c.req.valid('param');
    const body = c.req.valid('json');
    const publicContext = await resolvePublicOrganizationStore({
      database,
      orgSlug,
      storeSlug,
    });
    if (publicContext.error) {
      return c.json({ message: publicContext.error.message }, publicContext.error.status);
    }
    if (!publicContext.siteSetting.acceptBookings) {
      return c.json({ message: 'Public booking is not accepted for this store.' }, 409);
    }

    const slotRows = await database
      .select({
        slotId: dbSchema.slot.id,
        organizationId: dbSchema.slot.organizationId,
        storeId: dbSchema.slot.storeId,
        serviceId: dbSchema.slot.serviceId,
        startAt: dbSchema.slot.startAt,
        status: dbSchema.slot.status,
        publicStatus: dbSchema.slot.publicStatus,
        capacity: dbSchema.slot.capacity,
        reservedCount: dbSchema.slot.reservedCount,
        bookingOpenAt: dbSchema.slot.bookingOpenAt,
        bookingCloseAt: dbSchema.slot.bookingCloseAt,
        serviceIsActive: dbSchema.service.isActive,
        servicePublicStatus: dbSchema.service.publicStatus,
        bookingPolicy: dbSchema.service.bookingPolicy,
        requiresTicket: dbSchema.service.requiresTicket,
      })
      .from(dbSchema.slot)
      .innerJoin(dbSchema.service, eq(dbSchema.service.id, dbSchema.slot.serviceId))
      .where(
        and(
          eq(dbSchema.slot.id, body.slotId),
          eq(dbSchema.slot.organizationId, publicContext.organization.id),
          eq(dbSchema.slot.storeId, publicContext.store.id),
        ),
      )
      .limit(1);
    const slot = slotRows[0] ?? null;
    if (!slot || !slot.serviceIsActive) {
      return c.json({ message: 'Public event not found.' }, 404);
    }
    if (slot.servicePublicStatus === SERVICE_PUBLIC_STATUS.PRIVATE) {
      return c.json({ message: 'Public event not found.' }, 404);
    }
    if (slot.servicePublicStatus !== SERVICE_PUBLIC_STATUS.PUBLIC) {
      return c.json({ message: 'Public booking is not accepted for this service.' }, 409);
    }
    if (slot.publicStatus === SLOT_PUBLIC_STATUS.PRIVATE) {
      return c.json({ message: 'Public event not found.' }, 404);
    }
    if (slot.publicStatus !== SLOT_PUBLIC_STATUS.PUBLIC) {
      return c.json({ message: 'Public booking is not accepted for this slot.' }, 409);
    }
    if (slot.requiresTicket) {
      return c.json({ message: 'Ticket-required services cannot be booked as a guest.' }, 409);
    }
    if (body.serviceId && body.serviceId !== slot.serviceId) {
      return c.json({ message: 'Public event not found.' }, 404);
    }

    const now = new Date();
    const isBookable = isBookableSlot({
      slotStatus: slot.status,
      reservedCount: slot.reservedCount,
      capacity: slot.capacity,
      bookingOpenAt: slot.bookingOpenAt,
      bookingCloseAt: slot.bookingCloseAt,
      now,
    });
    if (!isBookable || slot.capacity - slot.reservedCount < body.participantsCount) {
      return c.json({ message: 'Slot is full or not bookable.' }, 409);
    }

    const requiredForms = await resolveRequiredForms({
      database,
      organizationId: publicContext.organization.id,
      storeId: publicContext.store.id,
      serviceId: slot.serviceId,
      slotId: slot.slotId,
    });
    if (body.formContextHash !== requiredForms.formContextHash) {
      return c.json({ message: 'FORM_CONTEXT_OUTDATED' }, 409);
    }
    const formValidation = validateFormSubmissions({
      forms: requiredForms.forms,
      submissions: body.formSubmissions,
      requireAllForms: true,
    });
    if (!formValidation.ok) {
      return c.json({ message: formValidation.message }, formValidation.status);
    }

    const status =
      slot.bookingPolicy === 'approval'
        ? BOOKING_STATUS.PENDING_APPROVAL
        : BOOKING_STATUS.CONFIRMED;

    const bookingId = crypto.randomUUID();
    const bookingPublicId = createBookingPublicId();
    const customerEmail = body.customer.email.trim().toLowerCase();
    const customerName = body.customer.name.trim();
    let cancelToken = '';
    let cancelUrl = '';
    try {
      await runDatabaseTransactionOrThrow(database, async (tx: AuthRuntimeDatabase) => {
        if (status === BOOKING_STATUS.CONFIRMED) {
          const reserved = await reservePublicSlotCapacity({
            database: tx,
            slotId: slot.slotId,
            participantsCount: body.participantsCount,
            now,
          });
          if (!reserved) {
            throw new Error('CAPACITY_OR_TIME_CONFLICT');
          }
        }

        await tx.insert(dbSchema.booking).values({
          id: bookingId,
          organizationId: slot.organizationId,
          storeId: slot.storeId,
          slotId: slot.slotId,
          serviceId: slot.serviceId,
          participantId: null,
          publicId: bookingPublicId,
          source: BOOKING_SOURCE.PUBLIC_SITE,
          participantsCount: body.participantsCount,
          customerName,
          customerEmail,
          customerPhone: normalizeOptionalText(body.customer.phone),
          note: normalizeOptionalText(body.note),
          createdByUserId: null,
          status,
          ticketPackId: null,
        });

        await insertPublicBookingDetails({
          database: tx,
          bookingId,
          companions: body.companions,
        });

        await insertFormSubmissions({
          database: tx,
          organizationId: slot.organizationId,
          storeId: slot.storeId,
          bookingId,
          participantId: null,
          customerName,
          customerEmail,
          source: 'public',
          submittedByUserId: null,
          submittedAt: now,
          submissions: formValidation.submissions,
        });

        cancelToken = await createPublicCancelToken({
          database: tx,
          bookingId,
          emailSnapshot: customerEmail,
          now,
        });
        cancelUrl = createPublicCancelUrl({
          env,
          requestUrl: c.req.raw.url,
          publicContext,
          bookingPublicId,
          token: cancelToken,
        });

        await writeBookingAuditLog({
          database: tx,
          bookingId,
          organizationId: slot.organizationId,
          storeId: slot.storeId,
          actorUserId: null,
          action: BOOKING_AUDIT_ACTION.CREATED,
          metadata: {
            initialStatus: status,
            participantsCount: body.participantsCount,
            source: BOOKING_SOURCE.PUBLIC_SITE,
          },
          headers: c.req.raw.headers,
        });

        const event =
          status === BOOKING_STATUS.PENDING_APPROVAL
            ? 'booking_application_received'
            : 'booking_confirmed';

        await Promise.all([
          enqueueBookingCustomerNotificationOutbox({
            database: tx,
            bookingId,
            event,
            actionUrl: cancelUrl,
            actionLabel: '予約をキャンセルする',
          }),
          enqueueBookingOperationalNotificationOutbox({
            database: tx,
            bookingId,
            event,
          }),
          status === BOOKING_STATUS.CONFIRMED
            ? enqueueBookingRemindersForBooking({
                database: tx,
                bookingId,
                now,
              })
            : Promise.resolve(),
        ]);
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CAPACITY_OR_TIME_CONFLICT') {
        return c.json({ message: 'Slot is full or not bookable.' }, 409);
      }
      throw error;
    }

    return c.json(
      {
        bookingId,
        bookingPublicId,
        status,
      },
      200,
    );
  });

  publicRoutes.openapi(cancelPublicBookingRoute, async (c) => {
    const { orgSlug, storeSlug, bookingPublicId } = c.req.valid('param');
    const body = c.req.valid('json');
    const publicContext = await resolvePublicOrganizationStore({
      database,
      orgSlug,
      storeSlug,
    });
    if (publicContext.error) {
      return c.json({ message: publicContext.error.message }, publicContext.error.status);
    }

    const tokenHash = await sha256Hex(body.token);
    const rows = await database
      .select({
        bookingId: dbSchema.booking.id,
        organizationId: dbSchema.booking.organizationId,
        storeId: dbSchema.booking.storeId,
        slotId: dbSchema.booking.slotId,
        serviceId: dbSchema.booking.serviceId,
        status: dbSchema.booking.status,
        participantsCount: dbSchema.booking.participantsCount,
        tokenId: dbSchema.bookingPublicActionToken.id,
        tokenExpiresAt: dbSchema.bookingPublicActionToken.expiresAt,
        tokenUsedAt: dbSchema.bookingPublicActionToken.usedAt,
        slotStartAt: dbSchema.slot.startAt,
        cancellationDeadlineMinutes: dbSchema.service.cancellationDeadlineMinutes,
      })
      .from(dbSchema.booking)
      .innerJoin(
        dbSchema.bookingPublicActionToken,
        and(
          eq(dbSchema.bookingPublicActionToken.bookingId, dbSchema.booking.id),
          eq(dbSchema.bookingPublicActionToken.purpose, 'cancel'),
          eq(dbSchema.bookingPublicActionToken.tokenHash, tokenHash),
        ),
      )
      .innerJoin(dbSchema.slot, eq(dbSchema.slot.id, dbSchema.booking.slotId))
      .innerJoin(dbSchema.service, eq(dbSchema.service.id, dbSchema.booking.serviceId))
      .where(
        and(
          eq(dbSchema.booking.publicId, bookingPublicId),
          eq(dbSchema.booking.organizationId, publicContext.organization.id),
          eq(dbSchema.booking.storeId, publicContext.store.id),
        ),
      )
      .limit(1);
    const booking = rows[0] ?? null;
    if (!booking) {
      return c.json({ message: 'Booking not found.' }, 404);
    }
    const now = new Date();
    if (booking.tokenUsedAt || new Date(booking.tokenExpiresAt).getTime() < now.getTime()) {
      return c.json({ message: 'Cancellation token is expired or already used.' }, 409);
    }

    const isPendingApproval = booking.status === BOOKING_STATUS.PENDING_APPROVAL;
    if (!isPendingApproval && booking.status !== BOOKING_STATUS.CONFIRMED) {
      return c.json({ message: 'Booking cannot be canceled.' }, 409);
    }

    if (!isPendingApproval) {
      const cancellationDeadlineMinutes =
        booking.cancellationDeadlineMinutes ?? DEFAULT_CANCELLATION_DEADLINE_MINUTES;
      const deadlineAt = new Date(
        new Date(booking.slotStartAt).getTime() - cancellationDeadlineMinutes * 60 * 1000,
      );
      if (now.getTime() > deadlineAt.getTime()) {
        return c.json({ message: 'Cancellation deadline has passed.' }, 409);
      }
    }

    await runDatabaseTransactionOrThrow(database, async (tx: AuthRuntimeDatabase) => {
      await tx
        .update(dbSchema.booking)
        .set({
          status: BOOKING_STATUS.CANCELLED,
          cancelReason: normalizeOptionalText(body.reason),
          cancelledAt: now,
          cancelledByUserId: null,
        })
        .where(eq(dbSchema.booking.id, booking.bookingId));

      if (!isPendingApproval) {
        await tx
          .update(dbSchema.slot)
          .set({
            reservedCount: sql`case
              when ${dbSchema.slot.reservedCount} >= ${booking.participantsCount}
              then ${dbSchema.slot.reservedCount} - ${booking.participantsCount}
              else 0
            end`,
          })
          .where(eq(dbSchema.slot.id, booking.slotId));
      }

      await tx
        .update(dbSchema.bookingPublicActionToken)
        .set({ usedAt: now })
        .where(eq(dbSchema.bookingPublicActionToken.id, booking.tokenId));

      await writeBookingAuditLog({
        database: tx,
        bookingId: booking.bookingId,
        organizationId: publicContext.organization.id,
        storeId: publicContext.store.id,
        actorUserId: null,
        action: BOOKING_AUDIT_ACTION.CANCELLED_BY_CUSTOMER,
        metadata: {
          reason: normalizeOptionalText(body.reason),
          source: BOOKING_SOURCE.PUBLIC_SITE,
        },
        headers: c.req.raw.headers,
      });

      await cancelPendingBookingReminderOutboxes({
        database: tx,
        bookingId: booking.bookingId,
        includeProcessing: true,
        now,
      });

      await Promise.all([
        enqueueBookingCustomerNotificationOutbox({
          database: tx,
          bookingId: booking.bookingId,
          event: 'booking_cancelled_by_participant',
          reason: normalizeOptionalText(body.reason),
        }),
        enqueueBookingOperationalNotificationOutbox({
          database: tx,
          bookingId: booking.bookingId,
          event: 'booking_cancelled_by_participant',
          reason: normalizeOptionalText(body.reason),
        }),
      ]);
    });

    return c.json({ ok: true }, 200);
  });

  return publicRoutes;
};
