import { expect, test } from '@playwright/test';
import {
	createAccount,
	createOrganizationInvitation,
	createOwnerOrganization,
	signUpAccount,
	startPremiumTrial,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';

test.describe('organization invitation acceptance', () => {
	test('allows only the addressed recipient to view and accept an organization invitation', async ({
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

		await page.goto(`/invitations/accept?invitationId=${encodeURIComponent(invitation.id)}`);
		await expect(page).toHaveURL(/\/admin\/login/);

		const recipientRequest = await playwright.request.newContext();
		try {
			await signUpAccount({ request: recipientRequest, account: recipient });
			await syncRequestCookiesToBrowser(recipientRequest, context);
		} finally {
			await recipientRequest.dispose();
		}

		await page.goto(`/invitations/accept?invitationId=${encodeURIComponent(invitation.id)}`);
		await expect(page).toHaveURL(/\/invitations\/accept/);
		await expect(page.getByRole('heading', { name: '招待内容の確認' })).toBeVisible();
		await expect(page.getByText(organization.name)).toBeVisible();

		await page.getByRole('button', { name: '承諾' }).click();
		await expect(page.getByText('管理者招待を承諾しました。')).toBeVisible();
		await expect(page.getByRole('button', { name: '承諾' })).toBeDisabled();
	});

	test('does not show invitation details to a different signed-in email', async ({
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

		const wrongUserRequest = await playwright.request.newContext();
		try {
			await signUpAccount({ request: wrongUserRequest, account: wrongUser });
			await syncRequestCookiesToBrowser(wrongUserRequest, context);
		} finally {
			await wrongUserRequest.dispose();
		}

		await page.goto(`/invitations/accept?invitationId=${encodeURIComponent(invitation.id)}`);
		await expect(page.getByRole('heading', { name: '招待内容の確認' })).toBeVisible();
		await expect(page.getByText('表示できる招待情報がありません。')).toBeVisible();
		await expect(page.getByText(/Forbidden|権限|招待情報の取得に失敗/)).toBeVisible();
		await expect(page.getByRole('button', { name: '承諾' })).toBeDisabled();
	});
});
