import { getBookingsPageData } from './bookings-page.remote';
import { query } from '$app/server';
import { z } from 'zod';

const adminSlotsQuerySchema = z.object({
	from: z.string().trim().min(1),
	to: z.string().trim().min(1),
	serviceId: z.string().trim().min(1).optional()
});

export const getAdminSlotsPageData = query(adminSlotsQuerySchema, async ({ from, to, serviceId }) => {
	const data = await getBookingsPageData({ from, to, serviceId });
	return {
		activeOrganizationId: data.activeOrganizationId,
		canManage: data.canManage,
		slots: data.slots,
		services: data.services
	};
});
