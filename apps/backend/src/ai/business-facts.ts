import { and, eq, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../auth-runtime.js';
import type { OrganizationClassroomAccess } from '../booking/authorization.js';
import * as dbSchema from '../db/schema.js';
import type { BusinessFactSummary } from './prompt.js';

const readCount = (rows: Array<{ count: number | string | null }>): number =>
  Number(rows[0]?.count ?? 0);

export const resolveBusinessFacts = async ({
  database,
  access,
}: {
  database: AuthRuntimeDatabase;
  access: OrganizationClassroomAccess;
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
            eq(dbSchema.service.classroomId, access.classroomId),
          ),
        ),
      database
        .select({ count: sql<number>`count(*)` })
        .from(dbSchema.participant)
        .where(
          and(
            eq(dbSchema.participant.organizationId, access.organizationId),
            eq(dbSchema.participant.classroomId, access.classroomId),
          ),
        ),
      database
        .select({ count: sql<number>`count(*)` })
        .from(dbSchema.ticketType)
        .where(
          and(
            eq(dbSchema.ticketType.organizationId, access.organizationId),
            eq(dbSchema.ticketType.classroomId, access.classroomId),
          ),
        ),
      database
        .select({ count: sql<number>`count(*)` })
        .from(dbSchema.invitation)
        .where(
          and(
            eq(dbSchema.invitation.organizationId, access.organizationId),
            eq(dbSchema.invitation.classroomId, access.classroomId),
          ),
        ),
    ]);
    const serviceCount = readCount(serviceRows);
    const participantCount = readCount(participantRows);
    const ticketTypeCount = readCount(ticketTypeRows);
    const invitationCount = readCount(invitationRows);

    factKeys.push('service_count', 'participant_count', 'ticket_type_count', 'invitation_count');
    lines.push(
      `対象classroomのサービス数: ${serviceCount}`,
      `対象classroomの参加者数: ${participantCount}`,
      `対象classroomのチケット種別数: ${ticketTypeCount}`,
      `対象classroomの招待数: ${invitationCount}`,
      `予約管理権限: ${access.effective.canManageBookings ? 'あり' : 'なし'}`,
      `参加者管理権限: ${access.effective.canManageParticipants ? 'あり' : 'なし'}`,
      `参加者予約権限: ${access.effective.canUseParticipantBooking ? 'あり' : 'なし'}`,
    );
  }

  const canReadOwnerBillingSummary = access.facts.orgRole === 'owner';
  const billingRows = await database
    .select({
      planCode: dbSchema.organizationBilling.planCode,
      subscriptionStatus: dbSchema.organizationBilling.subscriptionStatus,
      billingInterval: dbSchema.organizationBilling.billingInterval,
      paymentIssueStartedAt: dbSchema.organizationBilling.paymentIssueStartedAt,
      pastDueGraceEndsAt: dbSchema.organizationBilling.pastDueGraceEndsAt,
      billingProfileReadiness: dbSchema.organizationBilling.billingProfileReadiness,
      billingProfileNextAction: dbSchema.organizationBilling.billingProfileNextAction,
    })
    .from(dbSchema.organizationBilling)
    .where(eq(dbSchema.organizationBilling.organizationId, access.organizationId))
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
      `請求プロフィール状態: ${billing.billingProfileReadiness}`,
      `ownerの次アクション: ${billing.billingProfileNextAction ?? 'なし'}`,
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
