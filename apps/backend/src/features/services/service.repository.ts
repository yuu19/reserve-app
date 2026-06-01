import { and, desc, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import * as dbSchema from '../../infra/db/schema.js';

/**
 * service を D1 に作成します。
 */
export const insertService = async ({
  database,
  createdId,
  organizationId,
  storeId,
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
  publicStatus,
  isActive,
}: {
  database: AuthRuntimeDatabase;
  createdId: string;
  organizationId: string;
  storeId: string;
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
  publicStatus?: string;
  isActive: boolean;
}) => {
  await database.insert(dbSchema.service).values({
    id: createdId,
    organizationId,
    storeId,
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
    publicStatus: publicStatus ?? 'public',
    isActive,
  });
};

/**
 * service の最新行を ID で取得します。
 */
export const getServiceById = async (database: AuthRuntimeDatabase, serviceId: string) => {
  const rows = await database
    .select()
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, serviceId))
    .limit(1);
  return rows[0] ?? null;
};

/**
 * organization/store scope の service を、必要に応じて archived も含めて一覧します。
 */
export const listServices = async ({
  database,
  organizationId,
  storeId,
  includeArchived,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string;
  includeArchived?: boolean;
}) => {
  const filters = [eq(dbSchema.service.organizationId, organizationId)];
  if (storeId) {
    filters.push(eq(dbSchema.service.storeId, storeId));
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

/**
 * service 更新前の権限判定と premium 判定に必要な scope 情報を取得します。
 */
export const findServiceForUpdate = async (database: AuthRuntimeDatabase, serviceId: string) => {
  const currentRows = await database
    .select({
      id: dbSchema.service.id,
      organizationId: dbSchema.service.organizationId,
      storeId: dbSchema.service.storeId,
      bookingPolicy: dbSchema.service.bookingPolicy,
      requiresTicket: dbSchema.service.requiresTicket,
    })
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, serviceId))
    .limit(1);
  return currentRows[0] ?? null;
};

/**
 * service の archive 可否判定に必要な organization/store scope を取得します。
 */
export const findServiceScope = async (database: AuthRuntimeDatabase, serviceId: string) => {
  const serviceRows = await database
    .select({
      id: dbSchema.service.id,
      organizationId: dbSchema.service.organizationId,
      storeId: dbSchema.service.storeId,
    })
    .from(dbSchema.service)
    .where(eq(dbSchema.service.id, serviceId))
    .limit(1);
  return serviceRows[0] ?? null;
};

/**
 * 未指定フィールドを保持したまま service の変更分だけを D1 に反映します。
 */
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
    publicStatus?: string;
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
      ...(changes.publicStatus !== undefined ? { publicStatus: changes.publicStatus } : {}),
      ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
    })
    .where(eq(dbSchema.service.id, serviceId));
};

/**
 * service を物理削除せず inactive にして一覧対象から外します。
 */
export const archiveService = async (database: AuthRuntimeDatabase, serviceId: string) => {
  await database
    .update(dbSchema.service)
    .set({
      isActive: false,
    })
    .where(eq(dbSchema.service.id, serviceId));
};
