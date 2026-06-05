import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKING_STATUS, SLOT_STATUS } from '../../domain/booking/constants.js';
import type { BookingRouteContext } from './booking-route-context.js';
import { rescheduleBookingByStaff } from './reschedule-booking.usecase.js';

const auditMocks = vi.hoisted(() => ({
  writeBookingAuditLog: vi.fn(),
}));

const repositoryMocks = vi.hoisted(() => ({
  findBookingForReschedule: vi.fn(),
  findSlotForBookingReschedule: vi.fn(),
  insertBookingChangeLog: vi.fn(),
  releaseConfirmedBookingSlotCapacity: vi.fn(),
  reserveSlotCapacityForReschedule: vi.fn(),
  updateConfirmedBookingSlot: vi.fn(),
}));

const notificationMocks = vi.hoisted(() => ({
  notifyBookingEmailBestEffort: vi.fn(),
  notifyBookingOperationalEmailBestEffort: vi.fn(),
}));

vi.mock('../../domain/booking/audit.js', () => auditMocks);
vi.mock('./booking.repository.js', () => repositoryMocks);
vi.mock('./booking.notifications.js', () => notificationMocks);

const createContext = (): BookingRouteContext =>
  ({
    database: { kind: 'test-database' },
    env: {},
    requireIdentity: vi.fn(async () => ({
      userId: 'user-1',
      activeOrganizationId: 'organization-1',
    })),
    canManageBookingsScope: vi.fn(async () => true),
  }) as unknown as BookingRouteContext;

const createBooking = (overrides: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  organizationId: 'organization-1',
  storeId: 'store-1',
  slotId: 'slot-old',
  serviceId: 'service-1',
  participantId: 'participant-1',
  participantsCount: 2,
  status: BOOKING_STATUS.CONFIRMED,
  currentSlotStartAt: new Date('2026-07-01T10:00:00.000Z'),
  currentSlotEndAt: new Date('2026-07-01T11:00:00.000Z'),
  ...overrides,
});

const createTargetSlot = (overrides: Record<string, unknown> = {}) => ({
  id: 'slot-new',
  organizationId: 'organization-1',
  storeId: 'store-1',
  serviceId: 'service-1',
  startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  endAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
  capacity: 4,
  reservedCount: 1,
  status: SLOT_STATUS.OPEN,
  ...overrides,
});

describe('予約日程変更ユースケース', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMocks.findBookingForReschedule.mockResolvedValue(createBooking());
    repositoryMocks.findSlotForBookingReschedule.mockResolvedValue(createTargetSlot());
    repositoryMocks.reserveSlotCapacityForReschedule.mockResolvedValue(true);
    repositoryMocks.updateConfirmedBookingSlot.mockResolvedValue(true);
    repositoryMocks.releaseConfirmedBookingSlotCapacity.mockResolvedValue(undefined);
    repositoryMocks.insertBookingChangeLog.mockResolvedValue('change-log-1');
  });

  it('確定予約を同一サービスの将来枠へ変更しログと通知を残す', async () => {
    const ctx = createContext();

    const result = await rescheduleBookingByStaff(
      ctx,
      { bookingId: 'booking-1', targetSlotId: 'slot-new', reason: '日程調整' },
      new Headers(),
    );

    expect(result).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(repositoryMocks.reserveSlotCapacityForReschedule).toHaveBeenCalledWith({
      database: ctx.database,
      slotId: 'slot-new',
      participantsCount: 2,
      now: expect.any(Date),
    });
    expect(repositoryMocks.updateConfirmedBookingSlot).toHaveBeenCalledWith({
      database: ctx.database,
      bookingId: 'booking-1',
      currentSlotId: 'slot-old',
      targetSlotId: 'slot-new',
    });
    expect(repositoryMocks.releaseConfirmedBookingSlotCapacity).toHaveBeenCalledWith({
      database: ctx.database,
      slotId: 'slot-old',
      participantsCount: 2,
    });
    expect(repositoryMocks.insertBookingChangeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-1',
        organizationId: 'organization-1',
        storeId: 'store-1',
        reason: '日程調整',
        changedByUserId: 'user-1',
      }),
    );
    expect(auditMocks.writeBookingAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rescheduled',
        bookingId: 'booking-1',
      }),
    );
    expect(notificationMocks.notifyBookingEmailBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-1',
        event: 'booking_rescheduled',
        dedupeKeyExtra: 'change-log-1',
      }),
    );
    expect(notificationMocks.notifyBookingOperationalEmailBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-1',
        event: 'booking_rescheduled',
        dedupeKeyExtra: 'change-log-1',
      }),
    );
  });

  it('staff 権限がない予約の日程変更を拒否する', async () => {
    const ctx = createContext();
    ctx.canManageBookingsScope = vi.fn(async () => false);

    const result = await rescheduleBookingByStaff(
      ctx,
      { bookingId: 'booking-1', targetSlotId: 'slot-new' },
      new Headers(),
    );

    expect(result).toEqual({
      status: 403,
      body: { message: 'Forbidden' },
    });
    expect(repositoryMocks.findSlotForBookingReschedule).not.toHaveBeenCalled();
  });

  it('変更先が別サービスの場合は拒否する', async () => {
    const ctx = createContext();
    repositoryMocks.findSlotForBookingReschedule.mockResolvedValue(
      createTargetSlot({ serviceId: 'service-2' }),
    );

    const result = await rescheduleBookingByStaff(
      ctx,
      { bookingId: 'booking-1', targetSlotId: 'slot-new' },
      new Headers(),
    );

    expect(result).toEqual({
      status: 409,
      body: { message: 'Target slot must be for same service.' },
    });
    expect(repositoryMocks.reserveSlotCapacityForReschedule).not.toHaveBeenCalled();
  });

  it('変更先定員の確保後に予約状態が競合した場合は変更先定員を戻す', async () => {
    const ctx = createContext();
    repositoryMocks.updateConfirmedBookingSlot.mockResolvedValue(false);

    const result = await rescheduleBookingByStaff(
      ctx,
      { bookingId: 'booking-1', targetSlotId: 'slot-new' },
      new Headers(),
    );

    expect(result).toEqual({
      status: 409,
      body: { message: 'Only confirmed booking can be rescheduled.' },
    });
    expect(repositoryMocks.releaseConfirmedBookingSlotCapacity).toHaveBeenCalledWith({
      database: ctx.database,
      slotId: 'slot-new',
      participantsCount: 2,
    });
  });
});
