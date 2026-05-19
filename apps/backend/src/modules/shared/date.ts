import { DEFAULT_TIMEZONE } from '../../booking/constants.js';
import { isSupportedTimezone } from '../../booking/recurring.js';

export const parseIsoDateOrNull = (value: string | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

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

export const assertSupportedTimezone = (timezone: string | undefined): string | null => {
  const resolved = timezone ?? DEFAULT_TIMEZONE;
  return isSupportedTimezone(resolved) ? resolved : null;
};

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
