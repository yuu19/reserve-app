import { BOOKING_STATUS, type BookingStatus } from './constants.js';

/**
 * 予約 status の許可遷移です。
 *
 * 決済待ちや期限切れは先に状態語彙へ入れ、オンライン決済・キャンセル待ちの実装時に
 * usecase から同じ遷移表を参照できるようにしています。
 */
export const BOOKING_STATUS_TRANSITIONS = {
  [BOOKING_STATUS.PENDING_APPROVAL]: [
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.REJECTED,
    BOOKING_STATUS.CANCELLED,
    BOOKING_STATUS.EXPIRED,
  ],
  [BOOKING_STATUS.PENDING_PAYMENT]: [
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.CANCELLED,
    BOOKING_STATUS.EXPIRED,
  ],
  [BOOKING_STATUS.CONFIRMED]: [
    BOOKING_STATUS.CANCELLED,
    BOOKING_STATUS.NO_SHOW,
    BOOKING_STATUS.COMPLETED,
    BOOKING_STATUS.PENDING_PAYMENT,
  ],
  [BOOKING_STATUS.COMPLETED]: [BOOKING_STATUS.CONFIRMED],
  [BOOKING_STATUS.REJECTED]: [],
  [BOOKING_STATUS.CANCELLED]: [],
  [BOOKING_STATUS.NO_SHOW]: [],
  [BOOKING_STATUS.EXPIRED]: [],
} as const satisfies Record<BookingStatus, readonly BookingStatus[]>;

export const isBookingStatus = (value: unknown): value is BookingStatus =>
  typeof value === 'string' &&
  Object.values(BOOKING_STATUS).includes(value as BookingStatus);

export const canTransitionBookingStatus = (
  from: BookingStatus,
  to: BookingStatus,
): boolean => (BOOKING_STATUS_TRANSITIONS[from] as readonly BookingStatus[]).includes(to);
