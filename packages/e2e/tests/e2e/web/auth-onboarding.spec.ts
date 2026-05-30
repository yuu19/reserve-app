import { test } from '@playwright/test';
import {
	createAccount,
	signUpAccount,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';
import { AdminOnboardingPage } from '../pages';

test.describe('管理者認証とオンボーディング', () => {
	test('owner サインアップ後に最初の組織を作成する', async ({
		page,
		request,
		context
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'onboarding');
		const owner = createAccount(token, 'owner');
		const organizationName = `Onboarding ${token}`;
		const storeName = `Room ${token}`;
		const onboardingPage = new AdminOnboardingPage(page);

		await page.goto('/');
		await onboardingPage.expectLandingPage();

		await signUpAccount({ request, account: owner });
		await syncRequestCookiesToBrowser(request, context);
		await onboardingPage.gotoOnboarding();
		await onboardingPage.createInitialOrganization({ organizationName, storeName });

		await onboardingPage.expectDashboard({ organizationName, storeName });
	});
});
