import { toIsoDate } from './date.js';

export const serializeSlot = (row: Record<string, unknown> | undefined) => ({
  ...row,
  startAt: toIsoDate(row?.startAt),
  endAt: toIsoDate(row?.endAt),
  bookingOpenAt: toIsoDate(row?.bookingOpenAt),
  bookingCloseAt: toIsoDate(row?.bookingCloseAt),
  createdAt: toIsoDate(row?.createdAt),
  updatedAt: toIsoDate(row?.updatedAt),
});

export const serializeBooking = (row: Record<string, unknown> | undefined) => ({
  ...row,
  cancelledAt: toIsoDate(row?.cancelledAt),
  noShowMarkedAt: toIsoDate(row?.noShowMarkedAt),
  createdAt: toIsoDate(row?.createdAt),
  updatedAt: toIsoDate(row?.updatedAt),
});

export const parseTicketTypeServiceIds = (value: unknown): string[] => {
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

export const serializeTicketType = (row: Record<string, unknown> | undefined) => ({
  ...row,
  serviceIds: parseTicketTypeServiceIds(row?.serviceIdsJson),
  createdAt: toIsoDate(row?.createdAt),
  updatedAt: toIsoDate(row?.updatedAt),
});

export const serializeTicketPack = (row: Record<string, unknown> | undefined) => ({
  ...row,
  expiresAt: toIsoDate(row?.expiresAt),
  createdAt: toIsoDate(row?.createdAt),
  updatedAt: toIsoDate(row?.updatedAt),
});

export const serializeTicketPurchase = (row: Record<string, unknown> | undefined) => ({
  ...row,
  approvedAt: toIsoDate(row?.approvedAt),
  rejectedAt: toIsoDate(row?.rejectedAt),
  createdAt: toIsoDate(row?.createdAt),
  updatedAt: toIsoDate(row?.updatedAt),
});

export const serializeRecurringSchedule = (
  row: (Record<string, unknown> & { byWeekdayJson?: string | null }) | undefined,
) => ({
  ...row,
  byWeekday: row?.byWeekdayJson ? JSON.parse(row.byWeekdayJson) : [],
  createdAt: toIsoDate(row?.createdAt),
  updatedAt: toIsoDate(row?.updatedAt),
  lastGeneratedAt: toIsoDate(row?.lastGeneratedAt),
});

export const serializeRecurringException = (row: Record<string, unknown> | undefined) => ({
  ...row,
  createdAt: toIsoDate(row?.createdAt),
  updatedAt: toIsoDate(row?.updatedAt),
});
