import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { TICKET_PACK_STATUS, TICKET_PURCHASE_STATUS } from '../../booking/constants.js';
import * as dbSchema from '../../db/schema.js';

/**
 * ticket type に紐づける serviceIds が同一 organization/classroom に存在する数を返します。
 */
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

/**
 * ticket type を D1 に作成し、対象 serviceIds は JSON 文字列として保存します。
 */
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

/**
 * ticket type の最新行を ID で取得します。
 */
export const getTicketTypeById = async (database: AuthRuntimeDatabase, ticketTypeId: string) => {
  const rows = await database
    .select()
    .from(dbSchema.ticketType)
    .where(eq(dbSchema.ticketType.id, ticketTypeId))
    .limit(1);
  return rows[0] ?? null;
};

/**
 * staff 向けに organization/classroom/status で ticket type を一覧します。
 */
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

/**
 * participant が所属する classroom のうち販売中の ticket type だけを一覧します。
 */
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

/**
 * ticket purchase 作成時に購入対象 ticket type の販売可否と scope を取得します。
 */
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

/**
 * ticket purchase を承認待ち状態で D1 に作成します。
 */
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

/**
 * ticket purchase の最新行を ID で取得します。
 */
export const getTicketPurchaseById = async (database: AuthRuntimeDatabase, purchaseId: string) => {
  const rows = await database
    .select()
    .from(dbSchema.ticketPurchase)
    .where(eq(dbSchema.ticketPurchase.id, purchaseId))
    .limit(1);
  return rows[0] ?? null;
};

/**
 * participant/staff 向けに ticket purchase を scope と条件で一覧します。
 */
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

/**
 * ticket purchase の staff/participant 操作に必要な scope と状態を取得します。
 */
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

/**
 * 承認待ち ticket purchase だけを staff 却下状態へ遷移します。
 */
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

/**
 * participant が自身の ticket purchase を取り消した状態に更新します。
 */
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

/**
 * staff による ticket pack 付与前に participant の所属 classroom を確認します。
 */
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

/**
 * staff による ticket pack 付与前に ticket type の所属と付与枚数設定を取得します。
 */
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

/**
 * participant の active ticket pack のうち有効期限を過ぎたものを expired に更新します。
 */
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

/**
 * participant が所有する ticket pack を作成日時順で一覧します。
 */
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
