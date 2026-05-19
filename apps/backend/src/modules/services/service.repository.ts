import { and, desc, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import * as dbSchema from '../../db/schema.js';

export const insertService = async ({
  database,
  createdId,
  organizationId,
  classroomId,
  name,
  description,
  kind,
  imageUrl,
  durationMinutes,
  capacity,
  bookingOpenMinutesBefore,
  bookingCloseMinutesBefore,
  cancellationDeadlineMinutes,
  timezone,
  bookingPolicy,
  requiresTicket,
  isActive,
}: {
  database: AuthRuntimeDatabase;
  createdId: string;
  organizationId: string;
  classroomId: string;
  name: string;
  description: string | null;
  kind: string;
  imageUrl?: string | null;
  durationMinutes: number;
  capacity: number;
  bookingOpenMinutesBefore?: number;
  bookingCloseMinutesBefore?: number;
  cancellationDeadlineMinutes?: number;
  timezone: string;
  bookingPolicy: string;
  requiresTicket: boolean;
  isActive: boolean;
}) => {
  await database.insert(dbSchema.service).values({
    id: createdId,
    organizationId,
    classroomId,
    name,
    description,
    kind,
    imageUrl: imageUrl ?? null,
    durationMinutes,
    capacity,
    bookingOpenMinutesBefore,
    bookingCloseMinutesBefore,
    cancellationDeadlineMinutes,
    timezone,
    bookingPolicy,
    requiresTicket,
    isActive,
  });
};

export const getServiceById = async (database: AuthRuntimeDatabase, serviceId: string) => {
  const rows = await database
    .select()
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, serviceId))
    .limit(1);
  return rows[0] ?? null;
};

export const listServices = async ({
  database,
  organizationId,
  classroomId,
  includeArchived,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string;
  includeArchived?: boolean;
}) => {
  const filters = [eq(dbSchema.service.organizationId, organizationId)];
  if (classroomId) {
    filters.push(eq(dbSchema.service.classroomId, classroomId));
  }
  if (!includeArchived) {
    filters.push(eq(dbSchema.service.isActive, true));
  }

  return database
    .select()
    .from(dbSchema.service)
    .where(and(...filters))
    .orderBy(desc(dbSchema.service.createdAt));
};

export const findServiceForUpdate = async (database: AuthRuntimeDatabase, serviceId: string) => {
  const currentRows = await database
    .select({
      id: dbSchema.service.id,
      organizationId: dbSchema.service.organizationId,
      classroomId: dbSchema.service.classroomId,
      bookingPolicy: dbSchema.service.bookingPolicy,
      requiresTicket: dbSchema.service.requiresTicket,
    })
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, serviceId))
    .limit(1);
  return currentRows[0] ?? null;
};

export const findServiceScope = async (database: AuthRuntimeDatabase, serviceId: string) => {
  const serviceRows = await database
    .select({
      id: dbSchema.service.id,
      organizationId: dbSchema.service.organizationId,
      classroomId: dbSchema.service.classroomId,
    })
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, serviceId))
    .limit(1);
  return serviceRows[0] ?? null;
};

export const updateService = async ({
  database,
  serviceId,
  changes,
}: {
  database: AuthRuntimeDatabase;
  serviceId: string;
  changes: {
    name?: string;
    description?: string | null;
    kind?: string;
    imageUrl?: string | null;
    durationMinutes?: number;
    capacity?: number;
    bookingOpenMinutesBefore?: number;
    bookingCloseMinutesBefore?: number;
    cancellationDeadlineMinutes?: number;
    timezone?: string;
    bookingPolicy?: string;
    requiresTicket?: boolean;
    isActive?: boolean;
  };
}) => {
  await database
    .update(dbSchema.service)
    .set({
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.description !== undefined ? { description: changes.description } : {}),
      ...(changes.kind !== undefined ? { kind: changes.kind } : {}),
      ...(changes.imageUrl !== undefined ? { imageUrl: changes.imageUrl } : {}),
      ...(changes.durationMinutes !== undefined
        ? { durationMinutes: changes.durationMinutes }
        : {}),
      ...(changes.capacity !== undefined ? { capacity: changes.capacity } : {}),
      ...(changes.bookingOpenMinutesBefore !== undefined
        ? { bookingOpenMinutesBefore: changes.bookingOpenMinutesBefore }
        : {}),
      ...(changes.bookingCloseMinutesBefore !== undefined
        ? { bookingCloseMinutesBefore: changes.bookingCloseMinutesBefore }
        : {}),
      ...(changes.cancellationDeadlineMinutes !== undefined
        ? { cancellationDeadlineMinutes: changes.cancellationDeadlineMinutes }
        : {}),
      ...(changes.timezone !== undefined ? { timezone: changes.timezone } : {}),
      ...(changes.bookingPolicy !== undefined ? { bookingPolicy: changes.bookingPolicy } : {}),
      ...(changes.requiresTicket !== undefined ? { requiresTicket: changes.requiresTicket } : {}),
      ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
    })
    .where(eq(dbSchema.service.id, serviceId));
};

export const archiveService = async (database: AuthRuntimeDatabase, serviceId: string) => {
  await database
    .update(dbSchema.service)
    .set({
      isActive: false,
    })
    .where(eq(dbSchema.service.id, serviceId));
};
