import { test } from '@playwright/test';
import {
	acceptInvitation,
	createAccount,
	createOwnerOrganization,
	createParticipantInvitation,
	createService,
	createSlot,
	createTicketType,
	futureSlotRange,
	signUpAccount,
	startPremiumTrial,
	syncRequestCookiesToBrowser,
	updatePublicSiteSetting,
	uniqueToken
} from '../helpers/test-data';
import { PublicSitePage } from '../pages';

test.describe('公開店舗サイト', () => {
	test.setTimeout(120_000);

	test('予約ページと回数券カードを表示し参加者状態に応じた回数券CTAを出す', async ({
		page,
		request,
		context,
		playwright
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'public-site');
		const participant = createAccount(token, 'participant');
		const { organization } = await createOwnerOrganization({ request, token });
		await startPremiumTrial({ request, organization });
		await updatePublicSiteSetting({ request, organization });
		const service = await createService({
			request,
			organization,
			name: `Public service ${token}`
		});
		const slotRange = futureSlotRange();
		const slot = await createSlot({
			request,
			organization,
			service,
			startAt: slotRange.startAt,
			endAt: slotRange.endAt
		});
		const ticketType = await createTicketType({
			request,
			organization,
			name: `Public ticket ${token}`,
			totalCount: 6
		});
		const publicSite = new PublicSitePage(page);

		await publicSite.expectPublicHome({ organization, service, slot, ticketType });
		await publicSite.openTicketDetail({ organization, ticketType });
		await publicSite.expectLoggedOutCta();

		const participantInvitation = await createParticipantInvitation({
			request,
			organization,
			email: participant.email,
			participantName: participant.name
		});
		const participantRequest = await playwright.request.newContext();
		try {
			await signUpAccount({ request: participantRequest, account: participant });
			await acceptInvitation({ request: participantRequest, invitation: participantInvitation });
			await syncRequestCookiesToBrowser(participantRequest, context);
		} finally {
			await participantRequest.dispose();
		}

		await publicSite.gotoSite(organization);
		await publicSite.openTicketDetail({ organization, ticketType });
		await publicSite.expectLoggedInCta({ organization, ticketType });
	});
});
