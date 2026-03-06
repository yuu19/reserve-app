import { getBookingsPageData } from './bookings-page.remote';
import { query } from '$app/server';
import { z } from 'zod';

const adminRecurringQuerySchema = z.object({
	orgSlug: z.string().trim().min(1),
	classroomSlug: z.string().trim().min(1),
	from: z.string().trim().min(1),
	to: z.string().trim().min(1)
});

export const getAdminRecurringPageData = query(adminRecurringQuerySchema, async ({ orgSlug, classroomSlug, from, to }) => {
	const data = await getBookingsPageData({ orgSlug, classroomSlug, from, to });
	return {
		activeContext: data.activeContext,
		canManage: data.canManage,
		staffRecurringSchedules: data.staffRecurringSchedules,
		recurringSchedules: data.recurringSchedules,
		services: data.services
	};
});
