import { and, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { TICKET_LEDGER_ACTION, TICKET_PURCHASE_STATUS } from '../../domain/booking/constants.js';
import * as dbSchema from '../../infra/db/schema.js';
import {
  readStripeCheckoutSessionSummary,
  type StripeWebhookEvent,
} from '../../infra/payment/stripe.js';
import { normalizePackStatus, resolveEndDate } from './ticket.state.js';

/**
 * API から新規作成しなくなった旧 Stripe ticket checkout の完了 webhook を復旧処理します。
 */
export const handleLegacyTicketCheckoutWebhook = async ({
  database,
  event,
}: {
  database: AuthRuntimeDatabase;
  event: StripeWebhookEvent;
}): Promise<void> => {
  if (event.type !== 'checkout.session.completed') {
    return;
  }

  const session = readStripeCheckoutSessionSummary(event.data?.object ?? null);
  if (!session) {
    return;
  }

  const metadataPurchaseId =
    typeof session.metadata.purchaseId === 'string' && session.metadata.purchaseId.length > 0
      ? session.metadata.purchaseId
      : null;

  if (!metadataPurchaseId && !session.id) {
    return;
  }

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
    .where(
      metadataPurchaseId
        ? eq(dbSchema.ticketPurchase.id, metadataPurchaseId)
        : eq(dbSchema.ticketPurchase.stripeCheckoutSessionId, session.id),
    )
    .limit(1);
  const purchase = purchaseRows[0];
  if (!purchase) {
    return;
  }
  if (purchase.status === TICKET_PURCHASE_STATUS.APPROVED && purchase.ticketPackId) {
    return;
  }
  if (purchase.status !== TICKET_PURCHASE_STATUS.PENDING_PAYMENT) {
    return;
  }

  const [ticketTypeRows, participantRows] = await Promise.all([
    database
      .select({
        totalCount: dbSchema.ticketType.totalCount,
        expiresInDays: dbSchema.ticketType.expiresInDays,
      })
      .from(dbSchema.ticketType)
      .where(eq(dbSchema.ticketType.id, purchase.ticketTypeId))
      .limit(1),
    database
      .select({
        userId: dbSchema.participant.userId,
      })
      .from(dbSchema.participant)
      .where(eq(dbSchema.participant.id, purchase.participantId))
      .limit(1),
  ]);
  const ticketType = ticketTypeRows[0];
  const participant = participantRows[0];
  if (!ticketType || !participant) {
    console.warn(`[stripe-webhook] purchase context missing: purchaseId=${purchase.id}`);
    return;
  }

  const count = ticketType.totalCount;
  const expiresAt = resolveEndDate(ticketType.expiresInDays);
  const ticketPackId = crypto.randomUUID();
  const packStatus = normalizePackStatus({
    remainingCount: count,
    expiresAt,
  });

  await database.insert(dbSchema.ticketPack).values({
    id: ticketPackId,
    organizationId: purchase.organizationId,
    classroomId: purchase.classroomId,
    participantId: purchase.participantId,
    ticketTypeId: purchase.ticketTypeId,
    initialCount: count,
    remainingCount: count,
    expiresAt,
    status: packStatus,
  });

  await database.insert(dbSchema.ticketLedger).values({
    id: crypto.randomUUID(),
    organizationId: purchase.organizationId,
    classroomId: purchase.classroomId,
    ticketPackId,
    bookingId: null,
    action: TICKET_LEDGER_ACTION.GRANT,
    delta: count,
    balanceAfter: count,
    actorUserId: participant.userId,
    reason: 'purchase-approved-by-stripe',
  });

  const updatedRows = await database
    .update(dbSchema.ticketPurchase)
    .set({
      status: TICKET_PURCHASE_STATUS.APPROVED,
      ticketPackId,
      approvedAt: new Date(),
    })
    .where(
      and(
        eq(dbSchema.ticketPurchase.id, purchase.id),
        eq(dbSchema.ticketPurchase.status, TICKET_PURCHASE_STATUS.PENDING_PAYMENT),
      ),
    )
    .returning({
      id: dbSchema.ticketPurchase.id,
    });

  if (!updatedRows[0]) {
    await database
      .delete(dbSchema.ticketLedger)
      .where(eq(dbSchema.ticketLedger.ticketPackId, ticketPackId));
    await database.delete(dbSchema.ticketPack).where(eq(dbSchema.ticketPack.id, ticketPackId));
  }
};
