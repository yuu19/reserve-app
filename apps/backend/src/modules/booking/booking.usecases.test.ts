import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKING_STATUS, SLOT_STATUS } from '../../booking/constants.js';
import type { BookingRouteContext } from '../shared/route-context.js';
import { createBooking } from './booking.usecases.js';

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

vi.mock('../../booking/authorization.js', () => authorizationMocks);
vi.mock('../../booking/audit.js', () => auditMocks);
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
    repositoryMocks.releaseSlotCapacity.mockResolvedValue(undefined);
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
});
