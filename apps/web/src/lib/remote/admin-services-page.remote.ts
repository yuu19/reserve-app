import { getBookingsPageData } from './bookings-page.remote';
import { query } from '$app/server';
import { z } from 'zod';

const adminServicesQuerySchema = z.object({
	from: z.string().trim().min(1),
	to: z.string().trim().min(1)
});

export const getAdminServicesPageData = query(adminServicesQuerySchema, async ({ from, to }) => {
	const data = await getBookingsPageData({ from, to });
	return {
		activeOrganizationId: data.activeOrganizationId,
		canManage: data.canManage,
		staffServices: data.staffServices,
		services: data.services
	};
});
