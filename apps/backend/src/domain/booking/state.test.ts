import { describe, expect, it } from 'vitest';
import { BOOKING_STATUS } from './constants.js';
import { canTransitionBookingStatus, isBookingStatus } from './state.js';

describe('予約状態遷移', () => {
  it('承認待ちから承認・却下・キャンセルへ遷移できる', () => {
    expect(canTransitionBookingStatus(BOOKING_STATUS.PENDING_APPROVAL, BOOKING_STATUS.CONFIRMED))
      .toBe(true);
    expect(canTransitionBookingStatus(BOOKING_STATUS.PENDING_APPROVAL, BOOKING_STATUS.REJECTED))
      .toBe(true);
    expect(canTransitionBookingStatus(BOOKING_STATUS.PENDING_APPROVAL, BOOKING_STATUS.CANCELLED))
      .toBe(true);
  });

  it('確定予約から完了・キャンセル・No-show へ遷移できる', () => {
    expect(canTransitionBookingStatus(BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED)).toBe(
      true,
    );
    expect(canTransitionBookingStatus(BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CANCELLED)).toBe(
      true,
    );
    expect(canTransitionBookingStatus(BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.NO_SHOW)).toBe(
      true,
    );
  });

  it('終了状態から通常の運用状態へ戻さない', () => {
    expect(canTransitionBookingStatus(BOOKING_STATUS.CANCELLED, BOOKING_STATUS.CONFIRMED)).toBe(
      false,
    );
    expect(canTransitionBookingStatus(BOOKING_STATUS.REJECTED, BOOKING_STATUS.CONFIRMED)).toBe(
      false,
    );
    expect(canTransitionBookingStatus(BOOKING_STATUS.NO_SHOW, BOOKING_STATUS.CONFIRMED)).toBe(
      false,
    );
  });

  it('定義済み status だけを予約状態として扱う', () => {
    expect(isBookingStatus(BOOKING_STATUS.PENDING_PAYMENT)).toBe(true);
    expect(isBookingStatus('cancelled_by_staff')).toBe(false);
  });
});
