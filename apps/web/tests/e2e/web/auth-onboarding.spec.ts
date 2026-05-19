import { expect, test } from '@playwright/test';
import {
	createAccount,
	signUpAccount,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';

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

		await page.goto('/');
		await expect(
			page.getByRole('heading', { level: 1, name: /予約運用を、\s*ひとつの画面で。/ })
		).toBeVisible();
		await expect(page.getByRole('link', { name: '管理者としてログイン' }).first()).toBeVisible();

		await signUpAccount({ request, account: owner });
		await syncRequestCookiesToBrowser(request, context);
		await page.goto('/admin/onboarding');
		await page.getByLabel('組織名').fill(organizationName);
		await page.getByLabel('初期教室名').fill(classroomName);
		await page.getByRole('button', { name: '組織と教室を作成' }).click();

		await expect(page).toHaveURL(/\/admin\/dashboard/);
		await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
		await expect(page.getByText(organizationName)).toBeVisible();
		await expect(page.getByText(classroomName)).toBeVisible();
	});
});
