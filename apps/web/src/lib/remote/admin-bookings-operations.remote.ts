import { getBookingsPageData } from './bookings-page.remote';
import { query } from '$app/server';
import { z } from 'zod';

const adminBookingsOperationsQuerySchema = z.object({
	from: z.string().trim().min(1),
	to: z.string().trim().min(1),
	serviceId: z.string().trim().min(1).optional()
});

export const getAdminBookingsOperationsPageData = query(
	adminBookingsOperationsQuerySchema,
	async ({ from, to, serviceId }) => {
		const data = await getBookingsPageData({ from, to, serviceId });
		return {
			activeOrganizationId: data.activeOrganizationId,
			canManage: data.canManage,
			services: data.services,
			slots: data.slots,
			staffBookings: data.staffBookings,
			staffParticipants: data.staffParticipants
		};
	}
);
