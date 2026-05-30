import { test } from '@playwright/test';
import {
	acceptInvitation,
	createAccount,
	createOwnerOrganization,
	createParticipantInvitation,
	findTicketTypeByName,
	signUpAccount,
	startPremiumTrial,
	syncRequestCookiesToBrowser,
	updatePublicSiteSetting,
	uniqueToken
} from '../helpers/test-data';
import { TicketFlowPage } from '../pages';

test.describe('ticket purchase flow', () => {
	test.setTimeout(120_000);

	test('lets a participant request a ticket pack and an admin approve it', async ({
		page,
		request,
		context,
		playwright
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'tickets');
		const participant = createAccount(token, 'participant');
		const ticketName = `Ticket ${token}`;
		const { organization } = await createOwnerOrganization({ request, context, token });
		await startPremiumTrial({ request, organization });
		await updatePublicSiteSetting({ request, organization });
		await syncRequestCookiesToBrowser(request, context);
		const ticketFlow = new TicketFlowPage(page);

		await ticketFlow.createTicketTypeFromAdmin({
			organization,
			name: ticketName,
			totalCount: 8,
			expiresInDays: 60
		});
		const ticketType = await findTicketTypeByName({
			request,
			organization,
			name: ticketName
		});
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
			await context.clearCookies();
			await syncRequestCookiesToBrowser(participantRequest, context);

			await ticketFlow.openPublicTicketDetail({ organization, ticketType });
			await ticketFlow.followPurchaseCta({ organization, ticketType });
			await ticketFlow.submitPurchaseRequest(ticketType);

			await context.clearCookies();
			await syncRequestCookiesToBrowser(request, context);
			await ticketFlow.approvePurchaseForParticipant({
				organization,
				participantEmail: participant.email
			});

			await context.clearCookies();
			await syncRequestCookiesToBrowser(participantRequest, context);
			await ticketFlow.expectMyTicketPack({ organization, ticketType });
		} finally {
			await participantRequest.dispose();
		}
	});
});
