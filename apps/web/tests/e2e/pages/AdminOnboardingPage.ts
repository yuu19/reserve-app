import { expect, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class AdminOnboardingPage extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async expectLandingPage() {
		await expect(
			this.page.getByRole('heading', { level: 1, name: /予約運用を、\s*ひとつの画面で。/ })
		).toBeVisible();
		await expect(
			this.page.getByRole('link', { name: '管理者としてログイン' }).first()
		).toBeVisible();
	}

	async gotoOnboarding() {
		await this.goto('/admin/onboarding');
	}

	async createInitialOrganization({
		organizationName,
		storeName
	}: {
		organizationName: string;
		storeName: string;
	}) {
		await this.page.getByLabel('組織名').fill(organizationName);
		await this.page.getByLabel('初期店舗名').fill(storeName);
		await this.page.getByRole('button', { name: '組織と店舗を作成' }).click();
	}

	async expectDashboard({
		organizationName,
		storeName
	}: {
		organizationName: string;
		storeName: string;
	}) {
		await expect(this.page).toHaveURL(/\/admin\/dashboard/);
		await expect(this.page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
		await expect(this.page.getByText(organizationName).first()).toBeVisible();
		await expect(this.page.getByText(storeName).first()).toBeVisible();
	}
}
