import type { BusinessFactsProvider, BusinessFactSummary } from '@repo/saas-chatbot-core';
import { and, eq, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import type { OrganizationStoreAccess } from '../../domain/booking/authorization.js';
import * as dbSchema from '../../infra/db/schema.js';

export type { BusinessFactSummary } from '@repo/saas-chatbot-core';

const readCount = (rows: Array<{ count: number | string | null }>): number =>
  Number(rows[0]?.count ?? 0);

/**
 * 呼び出し側の解決済みアクセスで安全に扱える、回答時点の DB 由来の事実を構築する。
 *
 * 請求詳細はオーナー限定とし、非オーナーの文脈にはオーナー確認が必要なことだけを
 * マスク済み概要として返す。
 */
export const resolveBusinessFacts = async ({
  database,
  access,
}: {
  database: AuthRuntimeDatabase;
  access: OrganizationStoreAccess;
}): Promise<BusinessFactSummary> => {
  const factKeys: string[] = [];
  const lines: string[] = [];
  const canUseOperationalFacts =
    access.effective.canManageBookings ||
    access.effective.canManageParticipants ||
    access.effective.canUseParticipantBooking;

  if (canUseOperationalFacts) {
    const [serviceRows, participantRows, ticketTypeRows, invitationRows] = await Promise.all([
      database
        .select({ count: sql<number>`count(*)` })
        .from(dbSchema.service)
        .where(
          and(
            eq(dbSchema.service.organizationId, access.organizationId),
            eq(dbSchema.service.storeId, access.storeId),
          ),
        ),
      database
        .select({ count: sql<number>`count(*)` })
        .from(dbSchema.participant)
        .where(
          and(
            eq(dbSchema.participant.organizationId, access.organizationId),
            eq(dbSchema.participant.storeId, access.storeId),
          ),
        ),
      database
        .select({ count: sql<number>`count(*)` })
        .from(dbSchema.ticketType)
        .where(
          and(
            eq(dbSchema.ticketType.organizationId, access.organizationId),
            eq(dbSchema.ticketType.storeId, access.storeId),
          ),
        ),
      database
        .select({ count: sql<number>`count(*)` })
        .from(dbSchema.invitation)
        .where(
          and(
            eq(dbSchema.invitation.organizationId, access.organizationId),
            eq(dbSchema.invitation.storeId, access.storeId),
          ),
        ),
    ]);
    const serviceCount = readCount(serviceRows);
    const participantCount = readCount(participantRows);
    const ticketTypeCount = readCount(ticketTypeRows);
    const invitationCount = readCount(invitationRows);

    factKeys.push('service_count', 'participant_count', 'ticket_type_count', 'invitation_count');
    lines.push(
      `対象storeのサービス数: ${serviceCount}`,
      `対象storeの参加者数: ${participantCount}`,
      `対象storeのチケット種別数: ${ticketTypeCount}`,
      `対象storeの招待数: ${invitationCount}`,
      `予約管理権限: ${access.effective.canManageBookings ? 'あり' : 'なし'}`,
      `参加者管理権限: ${access.effective.canManageParticipants ? 'あり' : 'なし'}`,
      `参加者予約権限: ${access.effective.canUseParticipantBooking ? 'あり' : 'なし'}`,
    );
  }

  const canReadOwnerBillingSummary = access.facts.orgRole === 'owner';
  const billingRows = await database
    .select({
      planCode: dbSchema.billingSubscription.planCode,
      subscriptionStatus: dbSchema.billingSubscription.status,
      billingInterval: dbSchema.billingSubscription.interval,
      paymentIssueStartedAt: dbSchema.billingPaymentIssue.issueStartedAt,
      pastDueGraceEndsAt: dbSchema.billingPaymentIssue.pastDueGraceEndsAt,
    })
    .from(dbSchema.billingAccount)
    .leftJoin(
      dbSchema.billingSubscription,
      eq(dbSchema.billingSubscription.billingAccountId, dbSchema.billingAccount.id),
    )
    .leftJoin(
      dbSchema.billingPaymentIssue,
      eq(dbSchema.billingPaymentIssue.billingAccountId, dbSchema.billingAccount.id),
    )
    .where(
      and(
        eq(dbSchema.billingAccount.subjectType, 'organization'),
        eq(dbSchema.billingAccount.subjectId, access.organizationId),
      ),
    )
    .limit(1);

  const billing = billingRows[0] ?? null;
  if (billing && canReadOwnerBillingSummary) {
    factKeys.push('billing_summary');
    lines.push(
      `課金プラン: ${billing.planCode}`,
      `契約状態: ${billing.subscriptionStatus}`,
      `課金間隔: ${billing.billingInterval ?? '未設定'}`,
      `支払い問題開始: ${billing.paymentIssueStartedAt ? billing.paymentIssueStartedAt.toISOString() : 'なし'}`,
      `支払い猶予終了: ${billing.pastDueGraceEndsAt ? billing.pastDueGraceEndsAt.toISOString() : 'なし'}`,
      `請求プロフィール状態: not_required`,
      `ownerの次アクション: なし`,
    );
  } else if (billing) {
    factKeys.push('billing_summary_redacted');
    lines.push('課金情報: ownerのみ詳細を確認できます。ownerへ確認してください。');
  }

  if (lines.length === 0) {
    lines.push('現在の権限で利用できる業務文脈はありません。');
  }

  return {
    factKeys,
    lines,
    sensitive: Boolean(billing),
  };
};

export type ReserveAppBusinessFactsProvider = BusinessFactsProvider<OrganizationStoreAccess>;

export const createReserveAppBusinessFactsProvider = ({
  database,
}: {
  database: AuthRuntimeDatabase;
}): ReserveAppBusinessFactsProvider => ({
  getFacts: (access) => resolveBusinessFacts({ database, access }),
});
