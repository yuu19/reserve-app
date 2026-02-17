import { and, eq, lt } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import { SLOT_STATUS } from './constants.js';
import { defaultRecurringRange, syncRecurringScheduleSlots } from './recurring.js';

export const runDailyBookingMaintenance = async ({
  database,
}: {
  database: AuthRuntimeDatabase;
}): Promise<{
  recurringSchedulesProcessed: number;
  slotsCreated: number;
  slotsCanceledBySkip: number;
  slotsCompleted: number;
}> => {
  const now = new Date();
  const { from, to } = defaultRecurringRange(now);

  const schedules = await database
    .select({
      id: dbSchema.recurringSchedule.id,
    })
    .from(dbSchema.recurringSchedule)
    .where(eq(dbSchema.recurringSchedule.isActive, true));

  let slotsCreated = 0;
  let slotsCanceledBySkip = 0;

  for (const schedule of schedules) {
    const result = await syncRecurringScheduleSlots({
      database,
      scheduleId: schedule.id,
      from,
      to,
    });
    slotsCreated += result.createdCount;
    slotsCanceledBySkip += result.canceledCount;
  }

  const completedResult = await database
    .update(dbSchema.slot)
    .set({
      status: SLOT_STATUS.COMPLETED,
    })
    .where(
      and(
        eq(dbSchema.slot.status, SLOT_STATUS.OPEN),
        lt(dbSchema.slot.startAt, now),
      ),
    );

  return {
    recurringSchedulesProcessed: schedules.length,
    slotsCreated,
    slotsCanceledBySkip,
    slotsCompleted: Number(completedResult.rowsAffected ?? 0),
  };
};

