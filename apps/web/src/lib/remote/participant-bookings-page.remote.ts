import { getBookingsPageData } from './bookings-page.remote';
import { query } from '$app/server';
import { z } from 'zod';

const participantBookingsQuerySchema = z.object({
	orgSlug: z.string().trim().min(1),
	storeSlug: z.string().trim().min(1),
	from: z.string().trim().min(1),
	to: z.string().trim().min(1),
	serviceId: z.string().trim().min(1).optional()
});

export const getParticipantBookingsPageData = query(
	participantBookingsQuerySchema,
	async ({ orgSlug, storeSlug, from, to, serviceId }) => {
		const data = await getBookingsPageData({ orgSlug, storeSlug, from, to, serviceId });
		return {
			activeContext: data.activeContext,
			organizationId: data.organizationId,
			canManage: false,
			premiumRestriction: data.premiumRestriction,
			participantAccessDenied: data.participantAccessDenied,
			services: data.services,
			slots: data.slots,
			availableSlots: data.availableSlots,
			myBookings: data.myBookings,
			myTicketPacks: data.myTicketPacks,
			purchasableTicketTypes: data.purchasableTicketTypes,
			myTicketPurchases: data.myTicketPurchases
		};
	}
);
