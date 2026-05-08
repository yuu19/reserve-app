import { and, desc, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import type {
  OrganizationBillingPaymentMethodStatus,
  OrganizationBillingPlanState,
  OrganizationBillingSubscriptionStatus,
} from './organization-billing.js';
import {
  normalizeOrganizationBillingNotificationChannel,
  normalizeOrganizationBillingNotificationDeliveryState,
  normalizeOrganizationBillingNotificationKind,
  resolveOrganizationBillingCommunicationType,
  resolveOrganizationBillingNotificationChannelLabel,
  type OrganizationBillingNotificationDeliveryState,
} from './organization-billing-notifications.js';
import {
  readOrganizationBillingInvoicePaymentEvents,
  type OrganizationBillingInvoicePaymentEvent,
} from './organization-billing-invoice-events.js';

export type OrganizationOwnerBillingHistoryEntryType =
  | 'plan_transition'
  | 'notification'
  | 'reconciliation'
  | 'payment_event';
export type OrganizationOwnerBillingHistoryEntryTone = 'neutral' | 'positive' | 'attention';

export type OrganizationOwnerBillingHistoryEntry = {
  id: string;
  eventType: OrganizationOwnerBillingHistoryEntryType;
  occurredAt: string | null;
  title: string;
  summary: string;
  billingContext: string | null;
  tone: OrganizationOwnerBillingHistoryEntryTone;
};

type SortableOwnerBillingHistoryEntry = OrganizationOwnerBillingHistoryEntry & {
  sortSequence: number | null;
};

const OWNER_BILLING_HISTORY_ENTRY_LIMIT = 20;

const planStateLabelMap: Record<OrganizationBillingPlanState, string> = {
  free: '無料プラン',
  premium_trial: 'Premiumトライアル',
  premium_paid: 'Premiumプラン',
};

const subscriptionStatusLabelMap: Record<OrganizationBillingSubscriptionStatus, string> = {
  free: 'Free',
  trialing: 'トライアル中',
  active: '有効',
  past_due: '支払い遅延',
  canceled: '解約済み',
  unpaid: '未払い',
  incomplete: '処理中',
};

const paymentMethodStatusLabelMap: Record<OrganizationBillingPaymentMethodStatus, string> = {
  not_started: '未登録',
  pending: '確認中',
  registered: '登録済み',
};

const billingIntervalLabelMap: Record<'month' | 'year', string> = {
  month: '月額',
  year: '年額',
};

const toIsoDateString = (value: unknown): string | null => {
  const candidate =
    value instanceof Date
      ? value
      : typeof value === 'number' || typeof value === 'string'
        ? new Date(value)
        : null;

  if (!candidate || Number.isNaN(candidate.getTime())) {
    return null;
  }

  return candidate.toISOString();
};

const formatJaDateTime = (value: string | null) => {
  if (!value) {
    return null;
  }

  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(candidate);
};

const buildBillingContext = ({
  planState,
  subscriptionStatus,
  paymentMethodStatus,
  billingInterval,
}: {
  planState: OrganizationBillingPlanState;
  subscriptionStatus: OrganizationBillingSubscriptionStatus;
  paymentMethodStatus: OrganizationBillingPaymentMethodStatus;
  billingInterval?: 'month' | 'year' | null;
}) => {
  const parts = [
    `契約状態: ${planStateLabelMap[planState]}`,
    `ステータス: ${subscriptionStatusLabelMap[subscriptionStatus]}`,
    `支払い方法: ${paymentMethodStatusLabelMap[paymentMethodStatus]}`,
  ];

  if (billingInterval) {
    parts.push(`請求周期: ${billingIntervalLabelMap[billingInterval]}`);
  }

  return parts.join(' / ');
};

const normalizePlanState = (value: unknown): OrganizationBillingPlanState => {
  return value === 'premium_trial' || value === 'premium_paid' ? value : 'free';
};

const normalizeSubscriptionStatus = (value: unknown): OrganizationBillingSubscriptionStatus => {
  return value === 'trialing' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'canceled' ||
    value === 'unpaid' ||
    value === 'incomplete'
    ? value
    : 'free';
};

const normalizePaymentMethodStatus = (value: unknown): OrganizationBillingPaymentMethodStatus => {
  return value === 'pending' || value === 'registered' ? value : 'not_started';
};

const normalizeBillingInterval = (value: unknown): 'month' | 'year' | null => {
  return value === 'month' || value === 'year' ? value : null;
};

const toHistoryToneFromSignalStatus = (
  value: 'pending' | 'mismatch' | 'unavailable' | 'resolved',
): OrganizationOwnerBillingHistoryEntryTone => {
  if (value === 'resolved') {
    return 'positive';
  }
  if (value === 'mismatch' || value === 'unavailable') {
    return 'attention';
  }
  return 'neutral';
};

const resolvePlanTransitionTitle = ({
  sourceKind,
  previousPlanState,
  nextPlanState,
}: {
  sourceKind: string;
  previousPlanState: OrganizationBillingPlanState;
  nextPlanState: OrganizationBillingPlanState;
}) => {
  if (sourceKind === 'trial_start') {
    return 'Premiumトライアルを開始しました';
  }

  if (sourceKind === 'trial_completion') {
    return nextPlanState === 'premium_paid'
      ? 'Premiumプランへ移行しました'
      : '無料プランへ戻りました';
  }

  if (sourceKind === 'webhook_checkout_completed') {
    return 'Premiumの申込内容を受け付けました';
  }

  if (previousPlanState !== nextPlanState) {
    return nextPlanState === 'free'
      ? '契約状態が無料プランへ更新されました'
      : '契約状態が更新されました';
  }

  return '契約状態が更新されました';
};

const resolvePlanTransitionSummary = ({
  sourceKind,
  previousPlanState,
  nextPlanState,
  previousSubscriptionStatus,
  nextSubscriptionStatus,
}: {
  sourceKind: string;
  previousPlanState: OrganizationBillingPlanState;
  nextPlanState: OrganizationBillingPlanState;
  previousSubscriptionStatus: OrganizationBillingSubscriptionStatus;
  nextSubscriptionStatus: OrganizationBillingSubscriptionStatus;
}) => {
  if (sourceKind === 'trial_start') {
    return '7日間のPremiumトライアルを開始しました。契約ページから状態の変化を確認できます。';
  }

  if (sourceKind === 'webhook_checkout_completed') {
    return 'Premiumの申込内容を受け付け、契約状態の反映を開始しました。';
  }

  if (sourceKind === 'trial_completion') {
    return nextPlanState === 'premium_paid'
      ? 'トライアル終了後もPremiumプランを継続しています。'
      : 'トライアル終了に伴い無料プランへ戻りました。';
  }

  return `${planStateLabelMap[previousPlanState]} / ${subscriptionStatusLabelMap[previousSubscriptionStatus]} から ${planStateLabelMap[nextPlanState]} / ${subscriptionStatusLabelMap[nextSubscriptionStatus]} へ更新されました。`;
};

const resolveNotificationTitle = ({
  deliveryState,
  channelLabel,
}: {
  deliveryState: OrganizationBillingNotificationDeliveryState;
  channelLabel: string;
}) => {
  switch (deliveryState) {
    case 'sent':
      return `トライアル終了前のお知らせを${channelLabel}で送信しました`;
    case 'failed':
      return `トライアル終了前のお知らせを${channelLabel}で送信できませんでした`;
    case 'skipped':
      return `トライアル終了前のお知らせの重複送信を省略しました`;
    case 'retried':
      return `トライアル終了前のお知らせを${channelLabel}で再送しています`;
    case 'unknown':
      return 'トライアル終了前のお知らせの状態を確認しています';
    default:
      return `トライアル終了前のお知らせを${channelLabel}で準備しました`;
  }
};

const resolveNotificationSummary = ({
  deliveryState,
  trialEndsAt,
  channelLabel,
}: {
  deliveryState: OrganizationBillingNotificationDeliveryState;
  trialEndsAt: string | null;
  channelLabel: string;
}) => {
  const formattedTrialEndsAt = formatJaDateTime(trialEndsAt);

  if (deliveryState === 'sent') {
    return formattedTrialEndsAt
      ? `${channelLabel}で契約内容の確認案内を送信しました。終了予定日は ${formattedTrialEndsAt} です。`
      : `${channelLabel}で契約内容の確認案内を送信しました。`;
  }

  if (deliveryState === 'failed') {
    return `${channelLabel}で契約内容の確認案内を送信できませんでした。時間をおいて再度履歴をご確認ください。`;
  }

  if (deliveryState === 'skipped') {
    return '同じ通知がすでに送信済みのため、重複送信を省略しました。';
  }

  if (deliveryState === 'retried') {
    return `${channelLabel}で契約内容の確認案内を再送しています。反映まで少し時間がかかる場合があります。`;
  }

  if (deliveryState === 'unknown') {
    return '契約内容の確認案内の配信状態を確認しています。';
  }

  return `${channelLabel}で契約内容の確認案内の送信準備を開始しました。`;
};

const resolvePaymentIssueNotificationTitle = ({
  notificationKind,
  deliveryState,
  channelLabel,
}: {
  notificationKind: string;
  deliveryState: OrganizationBillingNotificationDeliveryState;
  channelLabel: string;
}) => {
  const issueLabel =
    notificationKind === 'payment_action_required_email'
      ? '支払い認証依頼'
      : notificationKind === 'past_due_grace_reminder_email'
        ? '支払い遅延の猶予案内'
        : '支払い失敗のお知らせ';

  switch (deliveryState) {
    case 'sent':
      return `${issueLabel}を${channelLabel}で送信しました`;
    case 'failed':
      return `${issueLabel}を${channelLabel}で送信できませんでした`;
    case 'skipped':
      return `${issueLabel}の重複送信を省略しました`;
    case 'retried':
      return `${issueLabel}を${channelLabel}で再送しています`;
    case 'unknown':
      return `${issueLabel}の状態を確認しています`;
    default:
      return `${issueLabel}を${channelLabel}で準備しました`;
  }
};

const resolvePaymentIssueNotificationSummary = ({
  deliveryState,
  channelLabel,
}: {
  deliveryState: OrganizationBillingNotificationDeliveryState;
  channelLabel: string;
}) => {
  if (deliveryState === 'sent') {
    return `${channelLabel}で支払い状況の確認案内を送信しました。`;
  }
  if (deliveryState === 'failed') {
    return `${channelLabel}で支払い状況の確認案内を送信できませんでした。契約ページでも状態を確認できます。`;
  }
  if (deliveryState === 'skipped') {
    return '同じ支払い状況の確認案内が送信済みのため、重複送信を省略しました。';
  }
  if (deliveryState === 'retried') {
    return `${channelLabel}で支払い状況の確認案内を再送しています。`;
  }
  if (deliveryState === 'unknown') {
    return '支払い状況の確認案内の配信状態を確認しています。';
  }
  return `${channelLabel}で支払い状況の確認案内の送信準備を開始しました。`;
};

const resolveReconciliationTitle = (
  signalStatus: 'pending' | 'mismatch' | 'unavailable' | 'resolved',
) => {
  switch (signalStatus) {
    case 'resolved':
      return '契約状態の同期を確認しました';
    case 'mismatch':
      return '契約状態に差分が見つかりました';
    case 'unavailable':
      return '契約状態を確認できませんでした';
    default:
      return '契約状態の反映を確認しています';
  }
};

const resolveReconciliationSummary = (
  signalStatus: 'pending' | 'mismatch' | 'unavailable' | 'resolved',
) => {
  switch (signalStatus) {
    case 'resolved':
      return 'アプリ内の契約状態と決済サービスの状態が一致していることを確認しました。';
    case 'mismatch':
      return '契約状態に差分が見つかったため、最新状態の確認を進めています。';
    case 'unavailable':
      return '決済サービス側の契約状態を一時的に確認できませんでした。時間をおいて再度反映される場合があります。';
    default:
      return '決済サービス側の最新状態の反映を確認しています。';
  }
};

const buildPlanTransitionEntry = (row: {
  sequenceNumber: number;
  sourceKind: string;
  previousPlanState: unknown;
  nextPlanState: unknown;
  previousSubscriptionStatus: unknown;
  nextSubscriptionStatus: unknown;
  nextPaymentMethodStatus: unknown;
  nextBillingInterval: unknown;
  createdAt: unknown;
}) => {
  const previousPlanState = normalizePlanState(row.previousPlanState);
  const nextPlanState = normalizePlanState(row.nextPlanState);
  const previousSubscriptionStatus = normalizeSubscriptionStatus(row.previousSubscriptionStatus);
  const nextSubscriptionStatus = normalizeSubscriptionStatus(row.nextSubscriptionStatus);
  const nextPaymentMethodStatus = normalizePaymentMethodStatus(row.nextPaymentMethodStatus);
  const nextBillingInterval = normalizeBillingInterval(row.nextBillingInterval);
  const tone =
    nextPlanState === 'premium_trial' || nextPlanState === 'premium_paid' ? 'positive' : 'neutral';

  return {
    id: `audit:${row.sequenceNumber}`,
    eventType: 'plan_transition',
    occurredAt: toIsoDateString(row.createdAt),
    title: resolvePlanTransitionTitle({
      sourceKind: row.sourceKind,
      previousPlanState,
      nextPlanState,
    }),
    summary: resolvePlanTransitionSummary({
      sourceKind: row.sourceKind,
      previousPlanState,
      nextPlanState,
      previousSubscriptionStatus,
      nextSubscriptionStatus,
    }),
    billingContext: buildBillingContext({
      planState: nextPlanState,
      subscriptionStatus: nextSubscriptionStatus,
      paymentMethodStatus: nextPaymentMethodStatus,
      billingInterval: nextBillingInterval,
    }),
    tone,
    sortSequence: row.sequenceNumber,
  } satisfies SortableOwnerBillingHistoryEntry;
};

const buildNotificationEntry = (row: {
  sequenceNumber: number;
  notificationKind: unknown;
  channel: unknown;
  deliveryState: unknown;
  planState: unknown;
  subscriptionStatus: unknown;
  paymentMethodStatus: unknown;
  trialEndsAt: unknown;
  createdAt: unknown;
}) => {
  const planState = normalizePlanState(row.planState);
  const subscriptionStatus = normalizeSubscriptionStatus(row.subscriptionStatus);
  const paymentMethodStatus = normalizePaymentMethodStatus(row.paymentMethodStatus);
  const trialEndsAt = toIsoDateString(row.trialEndsAt);
  const notificationKind = normalizeOrganizationBillingNotificationKind(row.notificationKind);
  const channel = normalizeOrganizationBillingNotificationChannel(row.channel);
  const channelLabel = resolveOrganizationBillingNotificationChannelLabel(channel);
  const deliveryState = normalizeOrganizationBillingNotificationDeliveryState(row.deliveryState);
  const communicationType = resolveOrganizationBillingCommunicationType({
    notificationKind,
    channel,
  });

  return {
    id: `notification:${row.sequenceNumber}`,
    eventType: 'notification',
    occurredAt: toIsoDateString(row.createdAt),
    title:
      communicationType === 'payment_issue'
        ? resolvePaymentIssueNotificationTitle({
            notificationKind,
            deliveryState,
            channelLabel,
          })
        : resolveNotificationTitle({
            deliveryState,
            channelLabel,
          }),
    summary:
      communicationType === 'payment_issue'
        ? resolvePaymentIssueNotificationSummary({
            deliveryState,
            channelLabel,
          })
        : resolveNotificationSummary({
            deliveryState,
            trialEndsAt,
            channelLabel,
          }),
    billingContext: [
      buildBillingContext({
        planState,
        subscriptionStatus,
        paymentMethodStatus,
      }),
      communicationType === 'trial_will_end'
        ? `通知種別: トライアル終了前のお知らせ`
        : communicationType === 'payment_issue'
          ? `通知種別: 支払い状況のお知らせ`
          : null,
      `チャネル: ${channelLabel}`,
      trialEndsAt ? `終了予定: ${formatJaDateTime(trialEndsAt)}` : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' / '),
    tone:
      deliveryState === 'sent'
        ? 'positive'
        : deliveryState === 'failed' || deliveryState === 'unknown'
          ? 'attention'
          : 'neutral',
    sortSequence: row.sequenceNumber,
  } satisfies SortableOwnerBillingHistoryEntry;
};

type OwnerBillingNotificationHistoryRow = Parameters<typeof buildNotificationEntry>[0];

const buildReconciliationEntry = (row: {
  sequenceNumber: number;
  signalStatus: 'pending' | 'mismatch' | 'unavailable' | 'resolved';
  appPlanState: unknown;
  appSubscriptionStatus: unknown;
  appPaymentMethodStatus: unknown;
  createdAt: unknown;
}) => {
  const planState = normalizePlanState(row.appPlanState);
  const subscriptionStatus = normalizeSubscriptionStatus(row.appSubscriptionStatus);
  const paymentMethodStatus = normalizePaymentMethodStatus(row.appPaymentMethodStatus);

  return {
    id: `signal:reconciliation:${row.sequenceNumber}`,
    eventType: 'reconciliation',
    occurredAt: toIsoDateString(row.createdAt),
    title: resolveReconciliationTitle(row.signalStatus),
    summary: resolveReconciliationSummary(row.signalStatus),
    billingContext: buildBillingContext({
      planState,
      subscriptionStatus,
      paymentMethodStatus,
    }),
    tone: toHistoryToneFromSignalStatus(row.signalStatus),
    sortSequence: row.sequenceNumber,
  } satisfies SortableOwnerBillingHistoryEntry;
};

type OwnerBillingReconciliationHistoryRow = Parameters<typeof buildReconciliationEntry>[0];

const buildInvoicePaymentHistoryEntry = (
  event: OrganizationBillingInvoicePaymentEvent,
  index: number,
  events: OrganizationBillingInvoicePaymentEvent[],
) => {
  const eventTime = event.occurredAt ? Date.parse(event.occurredAt) : null;
  const hasPaymentIssueBeforeSuccess =
    event.eventType === 'payment_succeeded' &&
    events.some((candidate) => {
      const candidateTime = candidate.occurredAt ? Date.parse(candidate.occurredAt) : null;
      return (
        (candidate.eventType === 'payment_failed' ||
          candidate.eventType === 'payment_action_required') &&
        candidateTime !== null &&
        eventTime !== null &&
        candidateTime < eventTime
      );
    });
  const stalePaymentIssueAfterRecovery =
    (event.eventType === 'payment_failed' || event.eventType === 'payment_action_required') &&
    eventTime !== null &&
    events.some((candidate) => {
      const candidateTime = candidate.occurredAt ? Date.parse(candidate.occurredAt) : null;
      return (
        candidate.eventType === 'payment_succeeded' &&
        candidateTime !== null &&
        candidateTime > eventTime
      );
    });
  const title =
    event.eventType === 'invoice_available'
      ? '請求書の参照を確認しました'
      : event.eventType === 'payment_succeeded'
        ? hasPaymentIssueBeforeSuccess
          ? '支払い問題が解消されました'
          : '支払いが完了しました'
        : event.eventType === 'payment_action_required'
          ? stalePaymentIssueAfterRecovery
            ? '解消済みの支払い認証依頼を履歴として保持しています'
            : '支払い方法の認証が必要です'
          : stalePaymentIssueAfterRecovery
            ? '解消済みの支払い失敗を履歴として保持しています'
            : '支払いを完了できませんでした';
  const summary =
    event.eventType === 'invoice_available'
      ? 'Stripe 上の請求書参照を契約ページで確認できます。'
      : event.eventType === 'payment_succeeded'
        ? hasPaymentIssueBeforeSuccess
          ? '支払い成功イベントを受信し、支払い問題が解消済みとして扱われます。'
          : 'Stripe から支払い成功イベントを受信しました。'
        : event.eventType === 'payment_action_required'
          ? stalePaymentIssueAfterRecovery
            ? '支払い復旧後の古い認証依頼として、対応中の問題には戻さず履歴に残しています。'
            : '支払い方法の認証が必要な状態です。契約ページから対応状況を確認できます。'
          : stalePaymentIssueAfterRecovery
            ? '支払い復旧後の古い失敗通知として、対応中の問題には戻さず履歴に残しています。'
            : 'Stripe から支払い失敗イベントを受信しました。契約ページから対応状況を確認できます。';

  return {
    id: `invoice-payment-event:${event.id}`,
    eventType: 'payment_event',
    occurredAt: event.occurredAt ?? event.createdAt,
    title,
    summary,
    billingContext:
      [
        event.providerStatus ? `provider status: ${event.providerStatus}` : null,
        event.stripeInvoiceId ? `Stripe invoice: ${event.stripeInvoiceId}` : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' / ') || null,
    tone:
      event.eventType === 'payment_succeeded' || event.eventType === 'invoice_available'
        ? 'positive'
        : event.eventType === 'payment_failed' || event.eventType === 'payment_action_required'
          ? 'attention'
          : 'neutral',
    sortSequence: index * -1,
  } satisfies SortableOwnerBillingHistoryEntry;
};

const compareHistoryEntries = (
  left: SortableOwnerBillingHistoryEntry,
  right: SortableOwnerBillingHistoryEntry,
) => {
  const leftTime = left.occurredAt ? Date.parse(left.occurredAt) : Number.NEGATIVE_INFINITY;
  const rightTime = right.occurredAt ? Date.parse(right.occurredAt) : Number.NEGATIVE_INFINITY;
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  const leftSequence = left.sortSequence ?? Number.NEGATIVE_INFINITY;
  const rightSequence = right.sortSequence ?? Number.NEGATIVE_INFINITY;
  if (leftSequence !== rightSequence) {
    return rightSequence - leftSequence;
  }

  return left.id.localeCompare(right.id);
};

export const readOrganizationOwnerBillingHistory = async ({
  database,
  organizationId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
}) => {
  const [auditRows, notificationRows, reconciliationSignalRows, invoicePaymentEvents] =
    await Promise.all([
      database
        .select({
          sequenceNumber: dbSchema.organizationBillingAuditEvent.sequenceNumber,
          sourceKind: dbSchema.organizationBillingAuditEvent.sourceKind,
          previousPlanState: dbSchema.organizationBillingAuditEvent.previousPlanState,
          nextPlanState: dbSchema.organizationBillingAuditEvent.nextPlanState,
          previousSubscriptionStatus:
            dbSchema.organizationBillingAuditEvent.previousSubscriptionStatus,
          nextSubscriptionStatus: dbSchema.organizationBillingAuditEvent.nextSubscriptionStatus,
          nextPaymentMethodStatus: dbSchema.organizationBillingAuditEvent.nextPaymentMethodStatus,
          nextBillingInterval: dbSchema.organizationBillingAuditEvent.nextBillingInterval,
          createdAt: dbSchema.organizationBillingAuditEvent.createdAt,
        })
        .from(dbSchema.organizationBillingAuditEvent)
        .where(eq(dbSchema.organizationBillingAuditEvent.organizationId, organizationId))
        .orderBy(desc(dbSchema.organizationBillingAuditEvent.sequenceNumber))
        .limit(OWNER_BILLING_HISTORY_ENTRY_LIMIT),
      database
        .select({
          sequenceNumber: dbSchema.organizationBillingNotification.sequenceNumber,
          notificationKind: dbSchema.organizationBillingNotification.notificationKind,
          channel: dbSchema.organizationBillingNotification.channel,
          deliveryState: dbSchema.organizationBillingNotification.deliveryState,
          planState: dbSchema.organizationBillingNotification.planState,
          subscriptionStatus: dbSchema.organizationBillingNotification.subscriptionStatus,
          paymentMethodStatus: dbSchema.organizationBillingNotification.paymentMethodStatus,
          trialEndsAt: dbSchema.organizationBillingNotification.trialEndsAt,
          createdAt: dbSchema.organizationBillingNotification.createdAt,
        })
        .from(dbSchema.organizationBillingNotification)
        .where(eq(dbSchema.organizationBillingNotification.organizationId, organizationId))
        .orderBy(desc(dbSchema.organizationBillingNotification.sequenceNumber))
        .limit(OWNER_BILLING_HISTORY_ENTRY_LIMIT),
      database
        .select({
          sequenceNumber: dbSchema.organizationBillingSignal.sequenceNumber,
          signalStatus: dbSchema.organizationBillingSignal.signalStatus,
          appPlanState: dbSchema.organizationBillingSignal.appPlanState,
          appSubscriptionStatus: dbSchema.organizationBillingSignal.appSubscriptionStatus,
          appPaymentMethodStatus: dbSchema.organizationBillingSignal.appPaymentMethodStatus,
          createdAt: dbSchema.organizationBillingSignal.createdAt,
        })
        .from(dbSchema.organizationBillingSignal)
        .where(
          and(
            eq(dbSchema.organizationBillingSignal.organizationId, organizationId),
            eq(dbSchema.organizationBillingSignal.signalKind, 'reconciliation'),
          ),
        )
        .orderBy(desc(dbSchema.organizationBillingSignal.sequenceNumber))
        .limit(OWNER_BILLING_HISTORY_ENTRY_LIMIT),
      readOrganizationBillingInvoicePaymentEvents({
        database,
        organizationId,
        limit: OWNER_BILLING_HISTORY_ENTRY_LIMIT,
      }),
    ]);

  const entries = [
    ...auditRows.map(buildPlanTransitionEntry),
    ...notificationRows
      .filter(
        (row: { deliveryState: unknown }) =>
          row.deliveryState === 'requested' ||
          row.deliveryState === 'retried' ||
          row.deliveryState === 'sent' ||
          row.deliveryState === 'failed' ||
          typeof row.deliveryState === 'string',
      )
      .map((row: OwnerBillingNotificationHistoryRow) =>
        buildNotificationEntry({
          sequenceNumber: row.sequenceNumber,
          notificationKind: row.notificationKind,
          channel: row.channel,
          deliveryState: row.deliveryState,
          planState: row.planState,
          subscriptionStatus: row.subscriptionStatus,
          paymentMethodStatus: row.paymentMethodStatus,
          trialEndsAt: row.trialEndsAt,
          createdAt: row.createdAt,
        }),
      ),
    ...reconciliationSignalRows
      .filter(
        (row: { signalStatus: unknown }) =>
          row.signalStatus === 'pending' ||
          row.signalStatus === 'mismatch' ||
          row.signalStatus === 'unavailable' ||
          row.signalStatus === 'resolved',
      )
      .map((row: OwnerBillingReconciliationHistoryRow) =>
        buildReconciliationEntry({
          sequenceNumber: row.sequenceNumber,
          signalStatus: row.signalStatus,
          appPlanState: row.appPlanState,
          appSubscriptionStatus: row.appSubscriptionStatus,
          appPaymentMethodStatus: row.appPaymentMethodStatus,
          createdAt: row.createdAt,
        }),
      ),
    ...invoicePaymentEvents.map((event: OrganizationBillingInvoicePaymentEvent, index: number) =>
      buildInvoicePaymentHistoryEntry(event, index, invoicePaymentEvents),
    ),
  ]
    .sort(compareHistoryEntries)
    .slice(0, OWNER_BILLING_HISTORY_ENTRY_LIMIT)
    .map(({ sortSequence: _, ...entry }) => entry satisfies OrganizationOwnerBillingHistoryEntry);

  return { entries };
};
