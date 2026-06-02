/** 予約・繰り返し枠の既定 timezone。 */
export const DEFAULT_TIMEZONE = 'Asia/Tokyo';

/** 参加者キャンセルを許可する既定締切。単位は minutes。 */
export const DEFAULT_CANCELLATION_DEADLINE_MINUTES = 24 * 60;

/** 繰り返し枠を将来へ自動生成する既定 horizon。単位は days。 */
export const RECURRING_HORIZON_DAYS = 84;

/** Slot lifecycle で永続化する status 値。 */
export const SLOT_STATUS = {
  OPEN: 'open',
  CANCELED: 'canceled',
  COMPLETED: 'completed',
} as const;

/** 公開予約ページ上での slot 公開状態。 */
export const SLOT_PUBLIC_STATUS = {
  PUBLIC: 'public',
  PRIVATE: 'private',
  SUSPENDED: 'suspended',
} as const;

/** 予約 lifecycle で永続化する status 値。 */
export const BOOKING_STATUS = {
  CONFIRMED: 'confirmed',
  PENDING_APPROVAL: 'pending_approval',
  CANCELED_BY_PARTICIPANT: 'cancelled_by_participant',
  CANCELED_BY_STAFF: 'cancelled_by_staff',
  REJECTED_BY_STAFF: 'rejected_by_staff',
  NO_SHOW: 'no_show',
} as const;

/** 予約来店時に staff が記録する出欠 status 値。 */
export const BOOKING_ATTENDANCE_STATUS = {
  NOT_CHECKED: 'not_checked',
  CHECKED_IN: 'checked_in',
  ABSENT: 'absent',
  NO_SHOW: 'no_show',
} as const;

/** 公開予約サイトの公開状態。 */
export const PUBLIC_SITE_STATUS = {
  PUBLIC: 'public',
  PRIVATE: 'private',
  SUSPENDED: 'suspended',
} as const;

/** 公開予約ページ上での service 公開状態。 */
export const SERVICE_PUBLIC_STATUS = {
  PUBLIC: 'public',
  PRIVATE: 'private',
  SUSPENDED: 'suspended',
} as const;

/** 予約の流入元。 */
export const BOOKING_SOURCE = {
  PARTICIPANT: 'participant',
  PUBLIC_SITE: 'public_site',
  ADMIN: 'admin',
  PHONE: 'phone',
  LINE: 'line',
  STOREFRONT: 'storefront',
  OTHER: 'other',
} as const;

/** 回数券 pack の残数・期限から導かれる status 値。 */
export const TICKET_PACK_STATUS = {
  ACTIVE: 'active',
  EXHAUSTED: 'exhausted',
  EXPIRED: 'expired',
} as const;

/** 回数券購入でサポートする支払い方法。 */
export const TICKET_PURCHASE_METHOD = {
  STRIPE: 'stripe',
  CASH_ON_SITE: 'cash_on_site',
  BANK_TRANSFER: 'bank_transfer',
} as const;

/** 回数券購入申請の承認・却下 lifecycle status。 */
export const TICKET_PURCHASE_STATUS = {
  PENDING_PAYMENT: 'pending_payment',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED_BY_PARTICIPANT: 'cancelled_by_participant',
} as const;

/** 回数券 ledger に記録する残数変更 action。 */
export const TICKET_LEDGER_ACTION = {
  GRANT: 'grant',
  CONSUME: 'consume',
  RESTORE: 'restore',
  EXPIRE: 'expire',
  ADJUST: 'adjust',
} as const;
