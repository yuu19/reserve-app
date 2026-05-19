import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { TICKET_PACK_STATUS, TICKET_PURCHASE_STATUS } from '../../booking/constants.js';
import * as dbSchema from '../../db/schema.js';

export const countServicesByIds = async ({
  database,
  organizationId,
  classroomId,
  serviceIds,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId: string;
  serviceIds: string[];
}) => {
  const serviceCount = await database
    .select({
      value: sql<number>`count(*)`,
    })
    .from(dbSchema.service)
    .where(
      and(
        eq(dbSchema.service.organizationId, organizationId),
        eq(dbSchema.service.classroomId, classroomId),
        sql`${dbSchema.service.id} in (${sql.join(
          serviceIds.map((id) => sql`${id}`),
          sql`,`,
        )})`,
      ),
    );

  return Number(serviceCount[0]?.value ?? 0);
};

export const insertTicketType = async ({
  database,
  ticketTypeId,
  organizationId,
  classroomId,
  name,
  serviceIds,
  totalCount,
  expiresInDays,
  isActive,
  isForSale,
  stripePriceId,
}: {
  database: AuthRuntimeDatabase;
  ticketTypeId: string;
  organizationId: string;
  classroomId: string;
  name: string;
  serviceIds?: string[];
  totalCount: number;
  expiresInDays?: number;
  isActive?: boolean;
  isForSale?: boolean;
  stripePriceId?: string;
}) => {
  await database.insert(dbSchema.ticketType).values({
    id: ticketTypeId,
    organizationId,
    classroomId,
    name,
    serviceIdsJson: serviceIds ? JSON.stringify(serviceIds) : null,
    totalCount,
    expiresInDays: expiresInDays ?? null,
    isActive: isActive ?? true,
    isForSale: isForSale ?? false,
    stripePriceId: stripePriceId ?? null,
  });
};

export const getTicketTypeById = async (database: AuthRuntimeDatabase, ticketTypeId: string) => {
  const rows = await database
    .select()
    .from(dbSchema.ticketType)
    .where(eq(dbSchema.ticketType.id, ticketTypeId))
    .limit(1);
  return rows[0] ?? null;
};

export const listTicketTypes = async ({
  database,
  organizationId,
  classroomId,
  isActive,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string;
  isActive?: boolean;
}) => {
  const filters = [eq(dbSchema.ticketType.organizationId, organizationId)];
  if (classroomId) {
    filters.push(eq(dbSchema.ticketType.classroomId, classroomId));
  }
  if (isActive !== undefined) {
    filters.push(eq(dbSchema.ticketType.isActive, isActive));
  }

  return database
    .select()
    .from(dbSchema.ticketType)
    .where(and(...filters))
    .orderBy(desc(dbSchema.ticketType.createdAt));
};

export const listPurchasableTicketTypes = async ({
  database,
  organizationId,
  classroomId,
  accessibleClassroomIds,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string;
  accessibleClassroomIds: string[];
}) => {
  return database
    .select()
    .from(dbSchema.ticketType)
    .where(
      and(
        eq(dbSchema.ticketType.organizationId, organizationId),
        ...(classroomId
          ? [eq(dbSchema.ticketType.classroomId, classroomId)]
          : [inArray(dbSchema.ticketType.classroomId, accessibleClassroomIds)]),
        eq(dbSchema.ticketType.isActive, true),
        eq(dbSchema.ticketType.isForSale, true),
      ),
    )
    .orderBy(desc(dbSchema.ticketType.createdAt));
};

export const findTicketTypeForPurchase = async ({
  database,
  ticketTypeId,
  organizationId,
  classroomId,
}: {
  database: AuthRuntimeDatabase;
  ticketTypeId: string;
  organizationId: string;
  classroomId?: string;
}) => {
  const ticketTypeRows = await database
    .select({
      id: dbSchema.ticketType.id,
      organizationId: dbSchema.ticketType.organizationId,
      classroomId: dbSchema.ticketType.classroomId,
      totalCount: dbSchema.ticketType.totalCount,
      isActive: dbSchema.ticketType.isActive,
      isForSale: dbSchema.ticketType.isForSale,
    })
    .from(dbSchema.ticketType)
    .where(
      and(
        eq(dbSchema.ticketType.id, ticketTypeId),
        eq(dbSchema.ticketType.organizationId, organizationId),
        ...(classroomId ? [eq(dbSchema.ticketType.classroomId, classroomId)] : []),
      ),
    )
    .limit(1);
  return ticketTypeRows[0] ?? null;
};

export const insertTicketPurchase = async ({
  database,
  purchaseId,
  organizationId,
  classroomId,
  participantId,
  ticketTypeId,
  paymentMethod,
}: {
  database: AuthRuntimeDatabase;
  purchaseId: string;
  organizationId: string;
  classroomId: string;
  participantId: string;
  ticketTypeId: string;
  paymentMethod: string;
}) => {
  await database.insert(dbSchema.ticketPurchase).values({
    id: purchaseId,
    organizationId,
    classroomId,
    participantId,
    ticketTypeId,
    paymentMethod,
    status: TICKET_PURCHASE_STATUS.PENDING_APPROVAL,
  });
};

export const getTicketPurchaseById = async (database: AuthRuntimeDatabase, purchaseId: string) => {
  const rows = await database
    .select()
    .from(dbSchema.ticketPurchase)
    .where(eq(dbSchema.ticketPurchase.id, purchaseId))
    .limit(1);
  return rows[0] ?? null;
};

export const listTicketPurchases = async ({
  database,
  organizationId,
  classroomId,
  participantId,
  participantIds,
  paymentMethod,
  status,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string;
  participantId?: string;
  participantIds?: string[];
  paymentMethod?: string;
  status?: string;
}) => {
  const filters = [eq(dbSchema.ticketPurchase.organizationId, organizationId)];
  if (participantIds) {
    filters.push(inArray(dbSchema.ticketPurchase.participantId, participantIds));
  }
  if (classroomId) {
    filters.push(eq(dbSchema.ticketPurchase.classroomId, classroomId));
  }
  if (participantId) {
    filters.push(eq(dbSchema.ticketPurchase.participantId, participantId));
  }
  if (paymentMethod) {
    filters.push(eq(dbSchema.ticketPurchase.paymentMethod, paymentMethod));
  }
  if (status) {
    filters.push(eq(dbSchema.ticketPurchase.status, status));
  }

  return database
    .select()
    .from(dbSchema.ticketPurchase)
    .where(and(...filters))
    .orderBy(desc(dbSchema.ticketPurchase.createdAt));
};

export const findTicketPurchaseScope = async (
  database: AuthRuntimeDatabase,
  purchaseId: string,
) => {
  const purchaseRows = await database
    .select({
      id: dbSchema.ticketPurchase.id,
      organizationId: dbSchema.ticketPurchase.organizationId,
      classroomId: dbSchema.ticketPurchase.classroomId,
      participantId: dbSchema.ticketPurchase.participantId,
      status: dbSchema.ticketPurchase.status,
    })
    .from(dbSchema.ticketPurchase)
    .where(eq(dbSchema.ticketPurchase.id, purchaseId))
    .limit(1);
  return purchaseRows[0] ?? null;
};

export const rejectTicketPurchase = async ({
  database,
  purchaseId,
  actorUserId,
  reason,
}: {
  database: AuthRuntimeDatabase;
  purchaseId: string;
  actorUserId: string;
  reason?: string;
}) => {
  const updatedRows = await database
    .update(dbSchema.ticketPurchase)
    .set({
      status: TICKET_PURCHASE_STATUS.REJECTED,
      rejectedByUserId: actorUserId,
      rejectedAt: new Date(),
      rejectReason: reason ?? null,
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

  return updatedRows[0] ?? null;
};

export const cancelTicketPurchase = async ({
  database,
  purchaseId,
}: {
  database: AuthRuntimeDatabase;
  purchaseId: string;
}) => {
  await database
    .update(dbSchema.ticketPurchase)
    .set({
      status: TICKET_PURCHASE_STATUS.CANCELLED_BY_PARTICIPANT,
    })
    .where(eq(dbSchema.ticketPurchase.id, purchaseId));
};

export const findParticipantForTicketPackGrant = async ({
  database,
  organizationId,
  classroomId,
  participantId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string;
  participantId: string;
}) => {
  const participantRows = await database
    .select({
      id: dbSchema.participant.id,
      classroomId: dbSchema.participant.classroomId,
    })
    .from(dbSchema.participant)
    .where(
      and(
        eq(dbSchema.participant.id, participantId),
        eq(dbSchema.participant.organizationId, organizationId),
        ...(classroomId ? [eq(dbSchema.participant.classroomId, classroomId)] : []),
      ),
    )
    .limit(1);
  return participantRows[0] ?? null;
};

export const findTicketTypeForTicketPackGrant = async ({
  database,
  organizationId,
  classroomId,
  ticketTypeId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string;
  ticketTypeId: string;
}) => {
  const ticketTypeRows = await database
    .select({
      id: dbSchema.ticketType.id,
      classroomId: dbSchema.ticketType.classroomId,
      totalCount: dbSchema.ticketType.totalCount,
      expiresInDays: dbSchema.ticketType.expiresInDays,
    })
    .from(dbSchema.ticketType)
    .where(
      and(
        eq(dbSchema.ticketType.id, ticketTypeId),
        eq(dbSchema.ticketType.organizationId, organizationId),
        ...(classroomId ? [eq(dbSchema.ticketType.classroomId, classroomId)] : []),
      ),
    )
    .limit(1);
  return ticketTypeRows[0] ?? null;
};

export const expireActiveTicketPacks = async ({
  database,
  organizationId,
  classroomId,
  participantIds,
  now,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string;
  participantIds: string[];
  now: Date;
}) => {
  await database
    .update(dbSchema.ticketPack)
    .set({
      status: TICKET_PACK_STATUS.EXPIRED,
    })
    .where(
      and(
        eq(dbSchema.ticketPack.organizationId, organizationId),
        ...(classroomId ? [eq(dbSchema.ticketPack.classroomId, classroomId)] : []),
        inArray(dbSchema.ticketPack.participantId, participantIds),
        eq(dbSchema.ticketPack.status, TICKET_PACK_STATUS.ACTIVE),
        lte(dbSchema.ticketPack.expiresAt, now),
      ),
    );
};

export const listTicketPacks = async ({
  database,
  organizationId,
  classroomId,
  participantIds,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string;
  participantIds: string[];
}) => {
  return database
    .select()
    .from(dbSchema.ticketPack)
    .where(
      and(
        eq(dbSchema.ticketPack.organizationId, organizationId),
        ...(classroomId ? [eq(dbSchema.ticketPack.classroomId, classroomId)] : []),
        inArray(dbSchema.ticketPack.participantId, participantIds),
      ),
    )
    .orderBy(asc(dbSchema.ticketPack.createdAt));
};
