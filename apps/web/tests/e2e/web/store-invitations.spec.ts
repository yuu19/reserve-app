import { test } from '@playwright/test';
import {
	createAccount,
	createOwnerOrganization,
	findStoreInvitationByEmail,
	signUpAccount,
	startPremiumTrial,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';
import { StoreInvitationsPage } from '../pages';

test.describe('scoped store invitations', () => {
	test.setTimeout(120_000);

	test('manages store operator and participant invitations from the scoped store page', async ({
		page,
		request,
		context,
		playwright
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'store-invites');
		const operator = createAccount(token, 'operator');
		const participant = createAccount(token, 'participant');
		const { organization } = await createOwnerOrganization({ request, context, token });
		await startPremiumTrial({ request, organization });
		await syncRequestCookiesToBrowser(request, context);
		const invitations = new StoreInvitationsPage(page);

		await invitations.sendStoreOperatorInvitation({
			organization,
			email: operator.email
		});
		await invitations.resendInvitation(operator.email);
		await invitations.cancelInvitation(operator.email);

		await invitations.sendParticipantInvitation({
			organization,
			email: participant.email,
			participantName: participant.name
		});
		const participantInvitation = await findStoreInvitationByEmail({
			request,
			organization,
			email: participant.email,
			subjectKind: 'participant'
		});

		const participantRequest = await playwright.request.newContext();
		try {
			await signUpAccount({ request: participantRequest, account: participant });
			await context.clearCookies();
			await syncRequestCookiesToBrowser(participantRequest, context);
			await invitations.acceptParticipantInvitation(participantInvitation);
		} finally {
			await participantRequest.dispose();
		}
	});
});
