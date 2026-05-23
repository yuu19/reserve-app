import { test } from '@playwright/test';
import {
	createAccount,
	signUpAccount,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';
import { AdminOnboardingPage } from '../pages';

test.describe('admin authentication and onboarding', () => {
	test('creates the first organization after owner sign-up', async ({
		page,
		request,
		context
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'onboarding');
		const owner = createAccount(token, 'owner');
		const organizationName = `Onboarding ${token}`;
		const classroomName = `Room ${token}`;
		const onboardingPage = new AdminOnboardingPage(page);

		await page.goto('/');
		await onboardingPage.expectLandingPage();

		await signUpAccount({ request, account: owner });
		await syncRequestCookiesToBrowser(request, context);
		await onboardingPage.gotoOnboarding();
		await onboardingPage.createInitialOrganization({ organizationName, classroomName });

		await onboardingPage.expectDashboard({ organizationName, classroomName });
	});
});
