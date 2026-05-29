import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { TICKET_PACK_STATUS, TICKET_PURCHASE_STATUS } from '../../domain/booking/constants.js';
import * as dbSchema from '../../infra/db/schema.js';

/**
 * ticket type に紐づける serviceIds が同一 organization/store に存在する数を返します。
 */
export const countServicesByIds = async ({
  database,
  organizationId,
  storeId,
  serviceIds,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
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
        eq(dbSchema.service.storeId, storeId),
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
  storeId,
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
  storeId: string;
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
    storeId,
    name,
    serviceIdsJson: serviceIds && serviceIds.length > 0 ? JSON.stringify(serviceIds) : null,
    totalCount,
    expiresInDays: expiresInDays ?? null,
    isActive: isActive ?? true,
    isForSale: isForSale ?? false,
    stripePriceId: stripePriceId ?? null,
  });
};

/**
 * ticket type の運用設定を更新します。
 */
export const updateTicketType = async ({
  database,
  ticketTypeId,
  name,
  serviceIds,
  totalCount,
  expiresInDays,
  isActive,
  isForSale,
}: {
  database: AuthRuntimeDatabase;
  ticketTypeId: string;
  name?: string;
  serviceIds?: string[];
  totalCount?: number;
  expiresInDays?: number | null;
  isActive?: boolean;
  isForSale?: boolean;
}) => {
  const values: Partial<typeof dbSchema.ticketType.$inferInsert> = {};
  if (name !== undefined) {
    values.name = name;
  }
  if (serviceIds !== undefined) {
    values.serviceIdsJson = serviceIds.length > 0 ? JSON.stringify(serviceIds) : null;
  }
  if (totalCount !== undefined) {
    values.totalCount = totalCount;
  }
  if (expiresInDays !== undefined) {
    values.expiresInDays = expiresInDays;
  }
  if (isActive !== undefined) {
    values.isActive = isActive;
  }
  if (isForSale !== undefined) {
    values.isForSale = isForSale;
  }

  const updatedRows = await database
    .update(dbSchema.ticketType)
    .set(values)
    .where(eq(dbSchema.ticketType.id, ticketTypeId))
    .returning({
      id: dbSchema.ticketType.id,
    });

  return updatedRows[0] ?? null;
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
 * staff 向けに organization/store/status で ticket type を一覧します。
 */
export const listTicketTypes = async ({
  database,
  organizationId,
  storeId,
  isActive,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string;
  isActive?: boolean;
}) => {
  const filters = [eq(dbSchema.ticketType.organizationId, organizationId)];
  if (storeId) {
    filters.push(eq(dbSchema.ticketType.storeId, storeId));
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
 * participant が所属する store のうち販売中の ticket type だけを一覧します。
 */
export const listPurchasableTicketTypes = async ({
  database,
  organizationId,
  storeId,
  accessibleStoreIds,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string;
  accessibleStoreIds: string[];
}) => {
  return database
    .select()
    .from(dbSchema.ticketType)
    .where(
      and(
        eq(dbSchema.ticketType.organizationId, organizationId),
        ...(storeId
          ? [eq(dbSchema.ticketType.storeId, storeId)]
          : [inArray(dbSchema.ticketType.storeId, accessibleStoreIds)]),
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
  storeId,
}: {
  database: AuthRuntimeDatabase;
  ticketTypeId: string;
  organizationId: string;
  storeId?: string;
}) => {
  const ticketTypeRows = await database
    .select({
      id: dbSchema.ticketType.id,
      organizationId: dbSchema.ticketType.organizationId,
      storeId: dbSchema.ticketType.storeId,
      serviceIdsJson: dbSchema.ticketType.serviceIdsJson,
      totalCount: dbSchema.ticketType.totalCount,
      isActive: dbSchema.ticketType.isActive,
      isForSale: dbSchema.ticketType.isForSale,
    })
    .from(dbSchema.ticketType)
    .where(
      and(
        eq(dbSchema.ticketType.id, ticketTypeId),
        eq(dbSchema.ticketType.organizationId, organizationId),
        ...(storeId ? [eq(dbSchema.ticketType.storeId, storeId)] : []),
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
  storeId,
  participantId,
  ticketTypeId,
  serviceIds,
  paymentMethod,
}: {
  database: AuthRuntimeDatabase;
  purchaseId: string;
  organizationId: string;
  storeId: string;
  participantId: string;
  ticketTypeId: string;
  serviceIds: string[];
  paymentMethod: string;
}) => {
  await database.insert(dbSchema.ticketPurchase).values({
    id: purchaseId,
    organizationId,
    storeId,
    participantId,
    ticketTypeId,
    serviceIdsJson: serviceIds.length > 0 ? JSON.stringify(serviceIds) : null,
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
  storeId,
  participantId,
  participantIds,
  paymentMethod,
  status,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string;
  participantId?: string;
  participantIds?: string[];
  paymentMethod?: string;
  status?: string;
}) => {
  const filters = [eq(dbSchema.ticketPurchase.organizationId, organizationId)];
  if (participantIds) {
    filters.push(inArray(dbSchema.ticketPurchase.participantId, participantIds));
  }
  if (storeId) {
    filters.push(eq(dbSchema.ticketPurchase.storeId, storeId));
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
      storeId: dbSchema.ticketPurchase.storeId,
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
 * staff による ticket pack 付与前に participant の所属 store を確認します。
 */
export const findParticipantForTicketPackGrant = async ({
  database,
  organizationId,
  storeId,
  participantId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string;
  participantId: string;
}) => {
  const participantRows = await database
    .select({
      id: dbSchema.participant.id,
      storeId: dbSchema.participant.storeId,
    })
    .from(dbSchema.participant)
    .where(
      and(
        eq(dbSchema.participant.id, participantId),
        eq(dbSchema.participant.organizationId, organizationId),
        ...(storeId ? [eq(dbSchema.participant.storeId, storeId)] : []),
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
  storeId,
  ticketTypeId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string;
  ticketTypeId: string;
}) => {
  const ticketTypeRows = await database
    .select({
      id: dbSchema.ticketType.id,
      storeId: dbSchema.ticketType.storeId,
      serviceIdsJson: dbSchema.ticketType.serviceIdsJson,
      totalCount: dbSchema.ticketType.totalCount,
      expiresInDays: dbSchema.ticketType.expiresInDays,
      isActive: dbSchema.ticketType.isActive,
    })
    .from(dbSchema.ticketType)
    .where(
      and(
        eq(dbSchema.ticketType.id, ticketTypeId),
        eq(dbSchema.ticketType.organizationId, organizationId),
        ...(storeId ? [eq(dbSchema.ticketType.storeId, storeId)] : []),
      ),
    )
    .limit(1);
  return ticketTypeRows[0] ?? null;
};

/**
 * staff 操作前に ticket pack の scope と残数状態を取得します。
 */
export const findTicketPackForAdjustment = async (
  database: AuthRuntimeDatabase,
  ticketPackId: string,
) => {
  const rows = await database
    .select({
      id: dbSchema.ticketPack.id,
      organizationId: dbSchema.ticketPack.organizationId,
      storeId: dbSchema.ticketPack.storeId,
      participantId: dbSchema.ticketPack.participantId,
      ticketTypeId: dbSchema.ticketPack.ticketTypeId,
      initialCount: dbSchema.ticketPack.initialCount,
      remainingCount: dbSchema.ticketPack.remainingCount,
      expiresAt: dbSchema.ticketPack.expiresAt,
      status: dbSchema.ticketPack.status,
    })
    .from(dbSchema.ticketPack)
    .where(eq(dbSchema.ticketPack.id, ticketPackId))
    .limit(1);
  return rows[0] ?? null;
};

/**
 * participant の active ticket pack のうち有効期限を過ぎたものを expired に更新します。
 */
export const expireActiveTicketPacks = async ({
  database,
  organizationId,
  storeId,
  participantIds,
  now,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string;
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
        ...(storeId ? [eq(dbSchema.ticketPack.storeId, storeId)] : []),
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
  storeId,
  participantIds,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId?: string;
  participantIds: string[];
}) => {
  return database
    .select()
    .from(dbSchema.ticketPack)
    .where(
      and(
        eq(dbSchema.ticketPack.organizationId, organizationId),
        ...(storeId ? [eq(dbSchema.ticketPack.storeId, storeId)] : []),
        inArray(dbSchema.ticketPack.participantId, participantIds),
      ),
    )
    .orderBy(asc(dbSchema.ticketPack.createdAt));
};
