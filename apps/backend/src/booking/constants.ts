export const DEFAULT_TIMEZONE = 'Asia/Tokyo';
export const DEFAULT_CANCELLATION_DEADLINE_MINUTES = 24 * 60;
export const RECURRING_HORIZON_DAYS = 84;

export const SLOT_STATUS = {
  OPEN: 'open',
  CANCELED: 'canceled',
  COMPLETED: 'completed',
} as const;

export const BOOKING_STATUS = {
  CONFIRMED: 'confirmed',
  PENDING_APPROVAL: 'pending_approval',
  CANCELED_BY_PARTICIPANT: 'cancelled_by_participant',
  CANCELED_BY_STAFF: 'cancelled_by_staff',
  REJECTED_BY_STAFF: 'rejected_by_staff',
  NO_SHOW: 'no_show',
} as const;

export const TICKET_PACK_STATUS = {
  ACTIVE: 'active',
  EXHAUSTED: 'exhausted',
  EXPIRED: 'expired',
} as const;

export const TICKET_LEDGER_ACTION = {
  GRANT: 'grant',
  CONSUME: 'consume',
  RESTORE: 'restore',
  EXPIRE: 'expire',
  ADJUST: 'adjust',
} as const;
