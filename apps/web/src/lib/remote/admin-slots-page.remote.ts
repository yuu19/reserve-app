import { getBookingsPageData } from './bookings-page.remote';
import { query } from '$app/server';
import { z } from 'zod';

const adminSlotsQuerySchema = z.object({
	orgSlug: z.string().trim().min(1),
	classroomSlug: z.string().trim().min(1),
	from: z.string().trim().min(1),
	to: z.string().trim().min(1),
	serviceId: z.string().trim().min(1).optional()
});

export const getAdminSlotsPageData = query(adminSlotsQuerySchema, async ({ orgSlug, classroomSlug, from, to, serviceId }) => {
	const data = await getBookingsPageData({ orgSlug, classroomSlug, from, to, serviceId });
	return {
		activeContext: data.activeContext,
		canManage: data.canManage,
		slots: data.slots,
		services: data.services
	};
});
