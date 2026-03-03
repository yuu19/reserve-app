import { getBookingsPageData } from './bookings-page.remote';
import { query } from '$app/server';
import { z } from 'zod';

const adminRecurringQuerySchema = z.object({
	from: z.string().trim().min(1),
	to: z.string().trim().min(1)
});

export const getAdminRecurringPageData = query(adminRecurringQuerySchema, async ({ from, to }) => {
	const data = await getBookingsPageData({ from, to });
	return {
		activeOrganizationId: data.activeOrganizationId,
		canManage: data.canManage,
		staffRecurringSchedules: data.staffRecurringSchedules,
		recurringSchedules: data.recurringSchedules,
		services: data.services
	};
});
