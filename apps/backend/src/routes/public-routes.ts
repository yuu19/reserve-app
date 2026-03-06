import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, asc, eq, gte } from 'drizzle-orm';
import { resolveOrganizationClassroomContext } from '../booking/authorization.js';
import { SLOT_STATUS } from '../booking/constants.js';
import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';

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
          schema: z.array(publicEventSchema),
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
          schema: publicEventSchema,
        },
      },
    },
    404: {
      description: 'Public event not found',
    },
  },
});

const toIsoDate = (value: Date): string => value.toISOString();

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
  const configuredOrgSlug = env.PUBLIC_EVENTS_ORG_SLUG?.trim();
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

  const configuredClassroomSlug = env.PUBLIC_EVENTS_CLASSROOM_SLUG?.trim();
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
          eq(dbSchema.service.isActive, true),
          gte(dbSchema.slot.startAt, now),
        ),
      )
      .orderBy(asc(dbSchema.slot.startAt))
      .limit(300);

    return c.json(
      rows.map((row: (typeof rows)[number]) =>
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

    return c.json(
      formatPublicEvent(
        {
          ...row,
          organizationSlug: publicContext.organization.slug,
          classroomId: publicContext.classroom.id,
          classroomSlug: publicContext.classroom.slug,
        },
        new Date(),
      ),
      200,
    );
  });

  return publicRoutes;
};
