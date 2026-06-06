import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import { processDueNotificationOutbox } from './booking.notifications.js';

/**
 * due になった予約通知 outbox を処理します。
 *
 * @remarks
 * 互換名として残しているが、MVP移行後は reminder_log へ新規書き込みせず、
 * booking.reminder を含む notification_outbox を処理する。
 */
export const sendDueBookingReminders = async ({
  database,
  env,
  now = new Date(),
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  now?: Date;
}) => {
  await processDueNotificationOutbox({
    database,
    env,
    now,
    eventTypes: ['booking.reminder'],
  });
};
