import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import { resolveOrganizationClassroomContext } from '../domain/booking/authorization.js';
import { SLOT_STATUS } from '../domain/booking/constants.js';
import {
  resolvePublicEventsClassroomSlug,
  resolvePublicEventsOrganizationSlug,
  type AuthRuntimeDatabase,
  type AuthRuntimeEnv,
} from '../auth-runtime.js';
import * as dbSchema from '../infra/db/schema.js';
import {
  parseTicketServiceIds,
  resolveTicketServiceScope,
  type TicketServiceScope,
} from '../shared/serializers.js';

const publicTicketTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  totalCount: z.number(),
  expiresInDays: z.number().nullable().optional(),
  serviceScope: z.enum(['all', 'specific']),
  serviceIds: z.array(z.string()),
  serviceNames: z.array(z.string()),
});

const publicEventSchema = z.object({
  organizationId: z.string(),
  organizationSlug: z.string(),
  classroomId: z.string(),
  classroomSlug: z.string(),
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

const publicEventRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
  classroomSlug: z.string().min(1),
});

const listPublicEventsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/classrooms/{classroomSlug}/events',
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
      description: 'Public organization or classroom not found',
    },
  },
});

const publicEventDetailParamsSchema = publicEventRouteParamsSchema.extend({
  slotId: z.string().min(1),
});

const getPublicEventDetailRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/classrooms/{classroomSlug}/events/{slotId}',
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

const toIsoDate = (value: Date): string => value.toISOString();

type PublicTicketType = {
  id: string;
  name: string;
  totalCount: number;
  expiresInDays: number | null;
  serviceScope: TicketServiceScope;
  serviceIds: string[];
  serviceNames: string[];
};

type PublicTicketTypeRow = {
  id: string;
  name: string;
  serviceIdsJson: string | null;
  totalCount: number;
  expiresInDays: number | null;
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
  row: {
    organizationId: string;
    organizationSlug: string;
    classroomId: string;
    classroomSlug: string;
    serviceId: string;
    serviceName: string;
    serviceDescription: string | null;
    serviceImageUrl: string | null;
    serviceKind: 'single' | 'recurring';
    bookingPolicy: 'instant' | 'approval';
    requiresTicket: boolean;
    slotId: string;
    startAt: Date;
    endAt: Date;
    slotStatus: string;
    capacity: number;
    reservedCount: number;
    bookingOpenAt: Date;
    bookingCloseAt: Date;
    staffLabel: string | null;
    locationLabel: string | null;
  },
  now: Date,
) => {
  const remainingCount = Math.max(row.capacity - row.reservedCount, 0);
  return {
    organizationId: row.organizationId,
    organizationSlug: row.organizationSlug,
    classroomId: row.classroomId,
    classroomSlug: row.classroomSlug,
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
    capacity: row.capacity,
    reservedCount: row.reservedCount,
    remainingCount,
    bookingOpenAt: toIsoDate(row.bookingOpenAt),
    bookingCloseAt: toIsoDate(row.bookingCloseAt),
    isBookable: isBookableSlot({
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

const listPublicTicketTypes = async ({
  database,
  organizationId,
  classroomId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId: string;
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
        eq(dbSchema.ticketType.organizationId, organizationId),
        eq(dbSchema.ticketType.classroomId, classroomId),
        eq(dbSchema.ticketType.isActive, true),
        eq(dbSchema.ticketType.isForSale, true),
      ),
    )
    .orderBy(desc(dbSchema.ticketType.createdAt))) as PublicTicketTypeRow[];

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
              eq(dbSchema.service.classroomId, classroomId),
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
    };
  });
};

const resolvePublicOrganizationClassroom = async ({
  database,
  env,
  orgSlug,
  classroomSlug,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  orgSlug: string;
  classroomSlug: string;
}) => {
  const configuredOrgSlug = resolvePublicEventsOrganizationSlug(env);
  if (configuredOrgSlug && configuredOrgSlug !== orgSlug) {
    return {
      error: {
        status: 404 as const,
        message: 'Public events organization was not found.',
      },
      organization: null,
      classroom: null,
    };
  }

  const rows = await database
    .select({ value: dbSchema.organization.id })
    .from(dbSchema.organization)
    .where(eq(dbSchema.organization.slug, orgSlug))
    .limit(1);
  if (!rows[0]) {
    return {
      error: {
        status: 404 as const,
        message: 'Public events organization was not found.',
      },
      organization: null,
      classroom: null,
    };
  }

  const configuredClassroomSlug = resolvePublicEventsClassroomSlug(env);
  if (configuredClassroomSlug && classroomSlug !== configuredClassroomSlug) {
    return {
      error: {
        status: 404 as const,
        message: 'Public events classroom was not found.',
      },
      organization: null,
      classroom: null,
    };
  }

  const context = await resolveOrganizationClassroomContext({
    database,
    organizationSlug: orgSlug,
    classroomSlug,
  });
  if (!context) {
    return {
      error: {
        status: 404 as const,
        message: 'Public events classroom was not found.',
      },
      organization: null,
      classroom: null,
    };
  }

  return {
    error: null,
    organization: {
      id: context.organizationId,
      slug: context.organizationSlug,
      name: context.organizationName,
    },
    classroom: {
      id: context.classroomId,
      slug: context.classroomSlug,
      name: context.classroomName,
    },
  };
};

export const createPublicRoutes = ({
  database,
  env,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
}) => {
  const publicRoutes = new OpenAPIHono();

  publicRoutes.openapi(listPublicEventsRoute, async (c) => {
    const { orgSlug, classroomSlug } = c.req.valid('param');
    const publicContext = await resolvePublicOrganizationClassroom({
      database,
      env,
      orgSlug,
      classroomSlug,
    });
    if (publicContext.error) {
      return c.json({ message: publicContext.error.message }, publicContext.error.status);
    }

    const now = new Date();
    const [rows, ticketTypes] = await Promise.all([
      database
        .select({
          organizationId: dbSchema.slot.organizationId,
          serviceId: dbSchema.service.id,
          serviceName: dbSchema.service.name,
          serviceDescription: dbSchema.service.description,
          serviceImageUrl: dbSchema.service.imageUrl,
          serviceKind: dbSchema.service.kind,
          bookingPolicy: dbSchema.service.bookingPolicy,
          requiresTicket: dbSchema.service.requiresTicket,
          slotId: dbSchema.slot.id,
          startAt: dbSchema.slot.startAt,
          endAt: dbSchema.slot.endAt,
          slotStatus: dbSchema.slot.status,
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
            eq(dbSchema.slot.classroomId, publicContext.classroom.id),
            eq(dbSchema.service.isActive, true),
            gte(dbSchema.slot.startAt, now),
          ),
        )
        .orderBy(asc(dbSchema.slot.startAt))
        .limit(300),
      listPublicTicketTypes({
        database,
        organizationId: publicContext.organization.id,
        classroomId: publicContext.classroom.id,
      }),
    ]);

    return c.json(
      {
        events: rows.map((row: (typeof rows)[number]) =>
          formatPublicEvent(
            {
              ...row,
              organizationSlug: publicContext.organization.slug,
              classroomId: publicContext.classroom.id,
              classroomSlug: publicContext.classroom.slug,
            },
            now,
          ),
        ),
        ticketTypes,
      },
      200,
    );
  });

  publicRoutes.openapi(getPublicEventDetailRoute, async (c) => {
    const { slotId, orgSlug, classroomSlug } = c.req.valid('param');
    const publicContext = await resolvePublicOrganizationClassroom({
      database,
      env,
      orgSlug,
      classroomSlug,
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
        slotId: dbSchema.slot.id,
        startAt: dbSchema.slot.startAt,
        endAt: dbSchema.slot.endAt,
        slotStatus: dbSchema.slot.status,
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
          eq(dbSchema.slot.classroomId, publicContext.classroom.id),
          eq(dbSchema.slot.id, slotId),
          eq(dbSchema.service.isActive, true),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return c.json({ message: 'Public event not found.' }, 404);
    }

    const ticketTypes = await listPublicTicketTypes({
      database,
      organizationId: publicContext.organization.id,
      classroomId: publicContext.classroom.id,
    });

    return c.json(
      {
        ...formatPublicEvent(
          {
            ...row,
            organizationSlug: publicContext.organization.slug,
            classroomId: publicContext.classroom.id,
            classroomSlug: publicContext.classroom.slug,
          },
          new Date(),
        ),
        ticketTypes,
      },
      200,
    );
  });

  return publicRoutes;
};
