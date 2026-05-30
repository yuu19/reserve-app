import { test } from '@playwright/test';
import {
	createAccount,
	createOrganizationInvitation,
	createOwnerOrganization,
	signUpAccount,
	startPremiumTrial,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';
import { InvitationAcceptancePage } from '../pages';

test.describe('組織招待の受諾', () => {
	test('宛先の受信者だけが組織招待を表示して承諾できる', async ({
		page,
		request,
		context,
		playwright
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'invitation');
		const recipient = createAccount(token, 'recipient');
		const { organization } = await createOwnerOrganization({ request, token });
		await startPremiumTrial({ request, organization });
		const invitation = await createOrganizationInvitation({
			request,
			organization,
			email: recipient.email,
			role: 'member'
		});
		const invitationPage = new InvitationAcceptancePage(page);

		await invitationPage.gotoInvitation(invitation.id);
		await invitationPage.expectRedirectedToAdminLogin();

		const recipientRequest = await playwright.request.newContext();
		try {
			await signUpAccount({ request: recipientRequest, account: recipient });
			await syncRequestCookiesToBrowser(recipientRequest, context);
		} finally {
			await recipientRequest.dispose();
		}

		await invitationPage.gotoInvitation(invitation.id);
		await invitationPage.expectInvitationDetails(organization.name);

		await invitationPage.acceptInvitation();
	});

	test('別のサインイン済みメールには招待詳細を表示しない', async ({
		page,
		request,
		context,
		playwright
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'invitation-denied');
		const recipient = createAccount(token, 'recipient');
		const wrongUser = createAccount(token, 'wrong');
		const { organization } = await createOwnerOrganization({ request, token });
		await startPremiumTrial({ request, organization });
		const invitation = await createOrganizationInvitation({
			request,
			organization,
			email: recipient.email,
			role: 'member'
		});
		const invitationPage = new InvitationAcceptancePage(page);

		const wrongUserRequest = await playwright.request.newContext();
		try {
			await signUpAccount({ request: wrongUserRequest, account: wrongUser });
			await syncRequestCookiesToBrowser(wrongUserRequest, context);
		} finally {
			await wrongUserRequest.dispose();
		}

		await invitationPage.gotoInvitation(invitation.id);
		await invitationPage.expectUnavailableInvitation();
	});
});
