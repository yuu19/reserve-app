import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKING_STATUS, SLOT_STATUS } from '../../domain/booking/constants.js';
import type { BookingRouteContext } from './booking-route-context.js';
import { approveBookingByStaff } from './approve-booking.usecase.js';
import { cancelBookingByParticipant } from './cancel-booking.usecase.js';
import { createBooking } from './create-booking.usecase.js';

const authorizationMocks = vi.hoisted(() => ({
  findParticipantByUserAndOrganization: vi.fn(),
  resolveOrganizationId: vi.fn(),
}));

const auditMocks = vi.hoisted(() => ({
  writeBookingAuditLog: vi.fn(),
}));

const repositoryMocks = vi.hoisted(() => ({
  approvePendingBooking: vi.fn(),
  cancelBookingByParticipantState: vi.fn(),
  cancelBookingByStaffState: vi.fn(),
  consumeBookingTicketLedger: vi.fn(),
  findBookingForParticipantCancel: vi.fn(),
  findBookingScope: vi.fn(),
  findServiceCancellationPolicy: vi.fn(),
  findServiceForBookingCreate: vi.fn(),
  findSlotForBookingCreate: vi.fn(),
  findSlotStart: vi.fn(),
  getBookingById: vi.fn(),
  insertBooking: vi.fn(),
  listBookings: vi.fn(),
  markConfirmedBookingNoShow: vi.fn(),
  rejectPendingBooking: vi.fn(),
  releaseConfirmedBookingSlotCapacity: vi.fn(),
  releaseSlotCapacity: vi.fn(),
  reserveSlotCapacityForApproval: vi.fn(),
  reserveSlotCapacityForBookingCreate: vi.fn(),
  restoreTicketPackForBookingCancel: vi.fn(),
}));

const notificationMocks = vi.hoisted(() => ({
  notifyBookingEmailBestEffort: vi.fn(),
}));

const ticketStateMocks = vi.hoisted(() => ({
  consumeTicketPackForParticipant: vi.fn(),
  restoreConsumedTicketPackBalance: vi.fn(),
}));

vi.mock('../../domain/booking/authorization.js', () => authorizationMocks);
vi.mock('../../domain/booking/audit.js', () => auditMocks);
vi.mock('./booking.repository.js', () => repositoryMocks);
vi.mock('./booking.notifications.js', () => notificationMocks);
vi.mock('../tickets/ticket.state.js', () => ticketStateMocks);

const createContext = (): BookingRouteContext =>
  ({
    database: { kind: 'test-database' },
    env: {},
    requireIdentity: vi.fn(async () => ({
      userId: 'user-1',
      activeOrganizationId: 'organization-1',
    })),
    canManageBookingsScope: vi.fn(async () => true),
    requireOrganizationPremiumFeature: vi.fn(async () => ({
      allowed: true,
      body: { allowed: true },
      status: 200,
    })),
  }) as unknown as BookingRouteContext;

describe('booking usecases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizationMocks.findParticipantByUserAndOrganization.mockResolvedValue({
      id: 'participant-1',
    });
    repositoryMocks.findSlotForBookingCreate.mockResolvedValue({
      id: 'slot-1',
      organizationId: 'organization-1',
      classroomId: 'classroom-1',
      serviceId: 'service-1',
      status: SLOT_STATUS.OPEN,
      bookingOpenAt: new Date(Date.now() - 60_000),
      bookingCloseAt: new Date(Date.now() + 60_000),
    });
    repositoryMocks.findServiceForBookingCreate.mockResolvedValue({
      id: 'service-1',
      bookingPolicy: 'instant',
      requiresTicket: true,
    });
    repositoryMocks.reserveSlotCapacityForBookingCreate.mockResolvedValue(true);
    repositoryMocks.reserveSlotCapacityForApproval.mockResolvedValue(true);
    repositoryMocks.releaseSlotCapacity.mockResolvedValue(undefined);
    repositoryMocks.releaseConfirmedBookingSlotCapacity.mockResolvedValue(undefined);
    repositoryMocks.cancelBookingByParticipantState.mockResolvedValue(undefined);
    repositoryMocks.approvePendingBooking.mockResolvedValue(true);
    repositoryMocks.consumeBookingTicketLedger.mockResolvedValue(undefined);
    ticketStateMocks.consumeTicketPackForParticipant.mockResolvedValue({
      ticketPackId: 'ticket-pack-1',
      balanceAfter: 1,
    });
    ticketStateMocks.restoreConsumedTicketPackBalance.mockResolvedValue(undefined);
  });

  it('restores consumed ticket balance and reserved capacity when duplicate instant booking insert fails', async () => {
    const ctx = createContext();
    repositoryMocks.insertBooking.mockRejectedValue(
      new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: booking.slot_id'),
    );

    const result = await createBooking(ctx, { slotId: 'slot-1' }, new Headers());

    expect(result).toEqual({
      status: 409,
      body: { message: 'Duplicate booking is not allowed.' },
    });
    expect(ticketStateMocks.restoreConsumedTicketPackBalance).toHaveBeenCalledWith({
      database: ctx.database,
      ticketPackId: 'ticket-pack-1',
      participantsCount: 1,
    });
    expect(repositoryMocks.releaseSlotCapacity).toHaveBeenCalledWith({
      database: ctx.database,
      slotId: 'slot-1',
      participantsCount: 1,
    });
    expect(repositoryMocks.consumeBookingTicketLedger).not.toHaveBeenCalled();
  });

  it('does not consume ticket balance while creating pending approval bookings', async () => {
    const ctx = createContext();
    repositoryMocks.findServiceForBookingCreate.mockResolvedValue({
      id: 'service-1',
      bookingPolicy: 'approval',
      requiresTicket: true,
    });
    repositoryMocks.insertBooking.mockResolvedValue(undefined);
    repositoryMocks.getBookingById.mockResolvedValue({
      id: 'booking-1',
      status: BOOKING_STATUS.PENDING_APPROVAL,
    });

    const result = await createBooking(ctx, { slotId: 'slot-1' }, new Headers());

    expect(result.status).toBe(200);
    expect(ticketStateMocks.consumeTicketPackForParticipant).not.toHaveBeenCalled();
    expect(repositoryMocks.reserveSlotCapacityForBookingCreate).not.toHaveBeenCalled();
    expect(repositoryMocks.insertBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        status: BOOKING_STATUS.PENDING_APPROVAL,
        ticketPackId: null,
      }),
    );
  });

  it('restores slot capacity and ticket ledger state when participant cancels a confirmed booking', async () => {
    const ctx = createContext();
    repositoryMocks.findBookingForParticipantCancel.mockResolvedValue({
      id: 'booking-1',
      organizationId: 'organization-1',
      classroomId: 'classroom-1',
      participantId: 'participant-1',
      status: BOOKING_STATUS.CONFIRMED,
      participantsCount: 2,
      ticketPackId: 'ticket-pack-1',
      slotId: 'slot-1',
      serviceId: 'service-1',
    });
    repositoryMocks.findSlotStart.mockResolvedValue({
      id: 'slot-1',
      startAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    repositoryMocks.findServiceCancellationPolicy.mockResolvedValue({
      cancellationDeadlineMinutes: 60,
    });

    const result = await cancelBookingByParticipant(
      ctx,
      { bookingId: 'booking-1', reason: 'schedule changed' },
      new Headers(),
    );

    expect(result).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(repositoryMocks.cancelBookingByParticipantState).toHaveBeenCalledWith({
      database: ctx.database,
      bookingId: 'booking-1',
      reason: 'schedule changed',
      actorUserId: 'user-1',
    });
    expect(repositoryMocks.releaseConfirmedBookingSlotCapacity).toHaveBeenCalledWith({
      database: ctx.database,
      slotId: 'slot-1',
      participantsCount: 2,
    });
    expect(repositoryMocks.restoreTicketPackForBookingCancel).toHaveBeenCalledWith({
      database: ctx.database,
      organizationId: 'organization-1',
      classroomId: 'classroom-1',
      ticketPackId: 'ticket-pack-1',
      bookingId: 'booking-1',
      participantsCount: 2,
      actorUserId: 'user-1',
      reason: 'booking-canceled-by-participant',
    });
    expect(auditMocks.writeBookingAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'booking.cancelled_by_participant',
        bookingId: 'booking-1',
      }),
    );
    expect(notificationMocks.notifyBookingEmailBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-1',
        event: 'booking_cancelled_by_participant',
      }),
    );
  });

  it('compensates reserved capacity and consumed ticket when approval state update conflicts', async () => {
    const ctx = createContext();
    repositoryMocks.findBookingScope.mockResolvedValue({
      id: 'booking-1',
      organizationId: 'organization-1',
      classroomId: 'classroom-1',
      slotId: 'slot-1',
      serviceId: 'service-1',
      participantId: 'participant-1',
      participantsCount: 2,
      status: BOOKING_STATUS.PENDING_APPROVAL,
    });
    repositoryMocks.findServiceForBookingCreate.mockResolvedValue({
      id: 'service-1',
      bookingPolicy: 'approval',
      requiresTicket: true,
    });
    repositoryMocks.approvePendingBooking.mockResolvedValue(false);
    ticketStateMocks.consumeTicketPackForParticipant.mockResolvedValue({
      ticketPackId: 'ticket-pack-1',
      balanceAfter: 0,
    });

    const result = await approveBookingByStaff(ctx, { bookingId: 'booking-1' }, new Headers());

    expect(result).toEqual({
      status: 409,
      body: { message: 'Only pending approval booking can be approved.' },
    });
    expect(repositoryMocks.reserveSlotCapacityForApproval).toHaveBeenCalledWith({
      database: ctx.database,
      slotId: 'slot-1',
      participantsCount: 2,
    });
    expect(repositoryMocks.releaseSlotCapacity).toHaveBeenCalledWith({
      database: ctx.database,
      slotId: 'slot-1',
      participantsCount: 2,
    });
    expect(ticketStateMocks.restoreConsumedTicketPackBalance).toHaveBeenCalledWith({
      database: ctx.database,
      ticketPackId: 'ticket-pack-1',
      participantsCount: 2,
    });
    expect(repositoryMocks.consumeBookingTicketLedger).not.toHaveBeenCalled();
  });
});
