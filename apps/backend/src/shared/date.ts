import { DEFAULT_TIMEZONE } from '../domain/booking/constants.js';
import { isSupportedTimezone } from '../domain/booking/recurring.js';

/**
 * 任意入力の ISO 日時文字列を、usecase 側で扱う Date または null に正規化します。
 */
export const parseIsoDateOrNull = (value: string | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * D1/Drizzle から返る日時値を API レスポンス用の ISO 文字列へそろえます。
 */
export const toIsoDate = (value: unknown): string | null => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
};

/**
 * recurring schedule の日付指定をカレンダー日付として分解します。
 */
export const parseDateParts = (
  value: string,
): { year: number; month: number; day: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  return { year, month, day };
};

/**
 * 未指定時は既定タイムゾーンに寄せ、MVP で許可された timezone だけを返します。
 */
export const assertSupportedTimezone = (timezone: string | undefined): string | null => {
  const resolved = timezone ?? DEFAULT_TIMEZONE;
  return isSupportedTimezone(resolved) ? resolved : null;
};

/**
 * 予約通知メールで表示する日本語向け日時ラベルを生成します。
 */
export const formatDateTimeLabel = (value: Date, timezone: string) => {
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(value);
  } catch {
    return value.toISOString();
  }
};
