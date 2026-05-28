import { toIsoDate } from './date.js';

/**
 * slot 行の日時列を API レスポンス用に ISO 文字列へ正規化します。
 */
export const serializeSlot = (row: Record<string, unknown> | undefined) => ({
  ...row,
  startAt: toIsoDate(row?.startAt),
  endAt: toIsoDate(row?.endAt),
  bookingOpenAt: toIsoDate(row?.bookingOpenAt),
  bookingCloseAt: toIsoDate(row?.bookingCloseAt),
  createdAt: toIsoDate(row?.createdAt),
  updatedAt: toIsoDate(row?.updatedAt),
});

/**
 * booking 行の日時列を API レスポンス用に ISO 文字列へ正規化します。
 */
export const serializeBooking = (row: Record<string, unknown> | undefined) => ({
  ...row,
  cancelledAt: toIsoDate(row?.cancelledAt),
  noShowMarkedAt: toIsoDate(row?.noShowMarkedAt),
  createdAt: toIsoDate(row?.createdAt),
  updatedAt: toIsoDate(row?.updatedAt),
});

export type TicketServiceScope = 'all' | 'specific';

/**
 * D1 に JSON 文字列として保存した ticket serviceIds を安全に配列へ戻します。
 */
export const parseTicketServiceIds = (value: unknown): string[] => {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : [];
  } catch {
    return [];
  }
};

export const parseTicketTypeServiceIds = parseTicketServiceIds;

/**
 * serviceIds の有無から API 用の対象サービス範囲を解決します。
 */
export const resolveTicketServiceScope = (serviceIds: string[]): TicketServiceScope =>
  serviceIds.length > 0 ? 'specific' : 'all';

/**
 * ticket type 行の JSON 列と日時列を API レスポンス用に正規化します。
 */
export const serializeTicketType = (row: Record<string, unknown> | undefined) => {
  const serviceIds = parseTicketServiceIds(row?.serviceIdsJson);
  return {
    ...row,
    serviceScope: resolveTicketServiceScope(serviceIds),
    serviceIds,
    createdAt: toIsoDate(row?.createdAt),
    updatedAt: toIsoDate(row?.updatedAt),
  };
};

/**
 * ticket pack 行の有効期限と監査日時を API レスポンス用に正規化します。
 */
export const serializeTicketPack = (row: Record<string, unknown> | undefined) => {
  const serviceIds = parseTicketServiceIds(row?.serviceIdsJson);
  return {
    ...row,
    serviceScope: resolveTicketServiceScope(serviceIds),
    serviceIds,
    expiresAt: toIsoDate(row?.expiresAt),
    createdAt: toIsoDate(row?.createdAt),
    updatedAt: toIsoDate(row?.updatedAt),
  };
};

/**
 * ticket purchase 行の承認・却下日時を API レスポンス用に正規化します。
 */
export const serializeTicketPurchase = (row: Record<string, unknown> | undefined) => {
  const serviceIds = parseTicketServiceIds(row?.serviceIdsJson);
  return {
    ...row,
    serviceScope: resolveTicketServiceScope(serviceIds),
    serviceIds,
    approvedAt: toIsoDate(row?.approvedAt),
    rejectedAt: toIsoDate(row?.rejectedAt),
    createdAt: toIsoDate(row?.createdAt),
    updatedAt: toIsoDate(row?.updatedAt),
  };
};

/**
 * recurring schedule 行の曜日 JSON と生成管理日時を API レスポンス用に正規化します。
 */
export const serializeRecurringSchedule = (
  row: (Record<string, unknown> & { byWeekdayJson?: string | null }) | undefined,
) => ({
  ...row,
  byWeekday: row?.byWeekdayJson ? JSON.parse(row.byWeekdayJson) : [],
  createdAt: toIsoDate(row?.createdAt),
  updatedAt: toIsoDate(row?.updatedAt),
  lastGeneratedAt: toIsoDate(row?.lastGeneratedAt),
});

/**
 * recurring exception 行の監査日時を API レスポンス用に正規化します。
 */
export const serializeRecurringException = (row: Record<string, unknown> | undefined) => ({
  ...row,
  createdAt: toIsoDate(row?.createdAt),
  updatedAt: toIsoDate(row?.updatedAt),
});
