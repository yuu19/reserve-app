import { test } from '@playwright/test';
import {
	createAccount,
	createOwnerOrganization,
	createService,
	createSlot,
	expectPublicEventCapacity,
	futureSlotRange,
	publicEventsStoreSlug,
	publicEventsOrgSlug,
	signUpAccount,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';
import { PublicEventsPage, ScopedAdminPages } from '../pages';

test.describe('booking and public event flows', () => {
	test('shows seeded services and slots in scoped admin pages', async ({
		page,
		request,
		context
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'admin-booking');
		const { organization } = await createOwnerOrganization({ request, context, token });
		const service = await createService({
			request,
			organization,
			name: `Service ${token}`
		});
		const slotRange = futureSlotRange(1);
		await createSlot({
			request,
			organization,
			service,
			startAt: slotRange.startAt,
			endAt: slotRange.endAt
		});
		await syncRequestCookiesToBrowser(request, context);
		const scopedAdminPages = new ScopedAdminPages(page);

		await scopedAdminPages.expectServiceVisible({
			orgSlug: organization.slug,
			storeSlug: organization.storeSlug,
			serviceName: service.name
		});
		await scopedAdminPages.expectSlotVisible({
			orgSlug: organization.slug,
			storeSlug: organization.storeSlug,
			serviceName: service.name,
			locationLabel: 'E2E Room'
		});
	});

	test('lets a participant sign up and reserve a public event', async ({
		page,
		request,
		context,
		playwright
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'public-booking');
		const participant = createAccount(token, 'participant');
		const { organization } = await createOwnerOrganization({
			request,
			token,
			slug: publicEventsOrgSlug,
			storeSlug: publicEventsStoreSlug
		});
		const service = await createService({
			request,
			organization,
			name: `Public Event ${token}`
		});
		const slotRange = futureSlotRange(1);
		const slot = await createSlot({
			request,
			organization,
			service,
			startAt: slotRange.startAt,
			endAt: slotRange.endAt
		});
		const publicEventsPage = new PublicEventsPage(page);

		await publicEventsPage.gotoEvents();
		await publicEventsPage.openEventDetails({
			serviceName: service.name,
			orgSlug: publicEventsOrgSlug,
			storeSlug: publicEventsStoreSlug,
			slotId: slot.id
		});

		await publicEventsPage.reserveAsParticipant();
		await publicEventsPage.expectParticipantLogin();

		const participantRequest = await playwright.request.newContext();
		try {
			await signUpAccount({ request: participantRequest, account: participant });
			await syncRequestCookiesToBrowser(participantRequest, context);
		} finally {
			await participantRequest.dispose();
		}
		await publicEventsPage.gotoEvents();

		await publicEventsPage.openEventDetails({
			serviceName: service.name,
			orgSlug: publicEventsOrgSlug,
			storeSlug: publicEventsStoreSlug,
			slotId: slot.id
		});
		await publicEventsPage.reserveAsParticipant();

		await publicEventsPage.expectReservationComplete();
		await expectPublicEventCapacity({
			request,
			orgSlug: publicEventsOrgSlug,
			storeSlug: publicEventsStoreSlug,
			slotId: slot.id,
			remainingCount: 2,
			capacity: 3
		});
	});
});
