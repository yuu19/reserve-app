import { expect, type Page } from '@playwright/test';
import { expectNoScopedContextError, type TestOrganization } from '../helpers/test-data';
import { BasePage } from './BasePage';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class ScopedNavigationPage extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async gotoDashboard(organization: TestOrganization) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/dashboard`);
		await expect(this.page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
		await expect(this.page.getByRole('navigation', { name: '機能メニュー' })).toBeVisible({
			timeout: 30_000
		});
	}

	async openDashboardAction({
		organization,
		label,
		expectedPath
	}: {
		organization: TestOrganization;
		label: string;
		expectedPath: string;
	}) {
		await this.gotoDashboard(organization);
		await this.page.getByRole('button', { name: label }).click();
		await this.expectScopedPath(organization, expectedPath);
	}

	async openSidebarLink({
		organization,
		label,
		expectedPath
	}: {
		organization: TestOrganization;
		label: string;
		expectedPath: string;
	}) {
		await this.page
			.getByRole('navigation', { name: '機能メニュー' })
			.getByRole('link', { name: label })
			.click();
		await this.expectScopedPath(organization, expectedPath);
	}

	async switchToParticipantPortal() {
		await this.page.getByRole('button', { name: '参加者へ切替' }).click();
		await expect(this.page).toHaveURL(/\/participant\/home/);
	}

	async expectScopedPath(organization: TestOrganization, expectedPath: string) {
		await expect(this.page).toHaveURL(
			new RegExp(
				`/${escapeRegex(organization.slug)}/${escapeRegex(organization.storeSlug)}${escapeRegex(
					expectedPath
				)}(?:[?#].*)?$`
			)
		);
		await expectNoScopedContextError(this.page);
	}
}
