import { and, eq, gte, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import {
  TICKET_LEDGER_ACTION,
  TICKET_PACK_STATUS,
  TICKET_PURCHASE_STATUS,
} from '../../domain/booking/constants.js';
import * as dbSchema from '../../infra/db/schema.js';
import { parseIsoDateOrNull } from '../../shared/date.js';
import { serializeTicketPack, serializeTicketPurchase } from '../../shared/serializers.js';

/**
 * ticket type の有効期限日数または明示指定から ticket pack の終了日時を解決します。
 */
export const resolveEndDate = (
  ticketTypeExpiresInDays: number | null,
  explicitExpiresAt?: string,
): Date | null => {
  if (explicitExpiresAt) {
    const parsed = parseIsoDateOrNull(explicitExpiresAt);
    return parsed;
  }
  if (typeof ticketTypeExpiresInDays === 'number' && ticketTypeExpiresInDays > 0) {
    return new Date(Date.now() + ticketTypeExpiresInDays * 24 * 60 * 60 * 1000);
  }
  return null;
};

/**
 * 残数と有効期限から ticket pack の業務状態を算出します。
 */
export const normalizePackStatus = ({
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

/**
 * participant の active ticket pack から、期限が近いものを優先して必要枚数を消費します。
 *
 * @throws TICKET_REQUIRED 消費可能な pack がない場合。
 * @throws TICKET_CONFLICT 同時更新などで候補 pack の消費に失敗した場合。
 */
export const consumeTicketPackForParticipant = async ({
  database,
  organizationId,
  classroomId,
  participantId,
  participantsCount,
  now,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId?: string | null;
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
        ...(classroomId ? [eq(dbSchema.ticketPack.classroomId, classroomId)] : []),
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

/**
 * 予約作成・承認の補償処理で、消費済み ticket pack の残数と状態を復元します。
 */
export const restoreConsumedTicketPackBalance = async ({
  database,
  ticketPackId,
  participantsCount,
}: {
  database: AuthRuntimeDatabase;
  ticketPackId: string;
  participantsCount: number;
}) => {
  const restoredRows = await database
    .update(dbSchema.ticketPack)
    .set({
      remainingCount: sql`${dbSchema.ticketPack.remainingCount} + ${participantsCount}`,
    })
    .where(eq(dbSchema.ticketPack.id, ticketPackId))
    .returning({
      id: dbSchema.ticketPack.id,
      remainingCount: dbSchema.ticketPack.remainingCount,
      expiresAt: dbSchema.ticketPack.expiresAt,
    });
  const restoredPack = restoredRows[0];
  if (!restoredPack) {
    return;
  }

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
};

/**
 * ticket pack を発行し、grant ledger を同時に記録します。
 */
export const issueTicketPackWithLedger = async ({
  database,
  organizationId,
  classroomId,
  participantId,
  ticketTypeId,
  count,
  expiresAt,
  actorUserId,
  reason,
  bookingId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  classroomId: string;
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
    classroomId,
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
    classroomId,
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

/**
 * staff による発行済み ticket pack 調整を反映し、adjust ledger を記録します。
 */
export const adjustTicketPackWithLedger = async ({
  database,
  ticketPackId,
  remainingCount,
  expiresAt,
  actorUserId,
  reason,
}: {
  database: AuthRuntimeDatabase;
  ticketPackId: string;
  remainingCount: number;
  expiresAt: Date | null;
  actorUserId: string;
  reason: string;
}) => {
  const currentRows = await database
    .select({
      id: dbSchema.ticketPack.id,
      organizationId: dbSchema.ticketPack.organizationId,
      classroomId: dbSchema.ticketPack.classroomId,
      remainingCount: dbSchema.ticketPack.remainingCount,
    })
    .from(dbSchema.ticketPack)
    .where(eq(dbSchema.ticketPack.id, ticketPackId))
    .limit(1);
  const current = currentRows[0];
  if (!current) {
    return { kind: 'not_found' as const };
  }

  const status = normalizePackStatus({
    remainingCount,
    expiresAt,
  });
  const delta = remainingCount - current.remainingCount;

  const updatedRows = await database
    .update(dbSchema.ticketPack)
    .set({
      remainingCount,
      expiresAt,
      status,
    })
    .where(eq(dbSchema.ticketPack.id, ticketPackId))
    .returning();
  const updatedPack = updatedRows[0];
  if (!updatedPack) {
    return { kind: 'not_found' as const };
  }

  await database.insert(dbSchema.ticketLedger).values({
    id: crypto.randomUUID(),
    organizationId: current.organizationId,
    classroomId: current.classroomId,
    ticketPackId,
    bookingId: null,
    action: TICKET_LEDGER_ACTION.ADJUST,
    delta,
    balanceAfter: remainingCount,
    actorUserId,
    reason,
  });

  return {
    kind: 'adjusted' as const,
    ticketPack: serializeTicketPack(updatedPack as Record<string, unknown> | undefined),
  };
};

/**
 * 承認待ち ticket purchase を承認し、ticket pack 発行と購入行更新をまとめて処理します。
 *
 * @remarks
 * 購入行更新に失敗した場合は、先に作成した ticket pack と ledger を削除して補償します。
 */
export const approveTicketPurchaseWithIssue = async ({
  database,
  purchaseId,
  actorUserId,
  actorReason,
}: {
  database: AuthRuntimeDatabase;
  purchaseId: string;
  actorUserId: string;
  actorReason: string;
}) => {
  const purchaseRows = await database
    .select({
      id: dbSchema.ticketPurchase.id,
      organizationId: dbSchema.ticketPurchase.organizationId,
      classroomId: dbSchema.ticketPurchase.classroomId,
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
    database,
    organizationId: purchase.organizationId,
    classroomId: purchase.classroomId,
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
    await database
      .delete(dbSchema.ticketLedger)
      .where(eq(dbSchema.ticketLedger.ticketPackId, issued.ticketPackId));
    await database
      .delete(dbSchema.ticketPack)
      .where(eq(dbSchema.ticketPack.id, issued.ticketPackId));
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
