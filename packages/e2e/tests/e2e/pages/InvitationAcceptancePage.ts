import { expect, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class InvitationAcceptancePage extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async gotoInvitation(invitationId: string) {
		await this.goto(`/invitations/accept?invitationId=${encodeURIComponent(invitationId)}`);
	}

	async expectRedirectedToAdminLogin() {
		await expect(this.page).toHaveURL(/\/admin\/login/, { timeout: 15_000 });
	}

	async expectInvitationDetails(organizationName: string) {
		await expect(this.page).toHaveURL(/\/invitations\/accept/);
		await expect(this.page.getByRole('heading', { name: '招待内容の確認' })).toBeVisible();
		await expect(this.page.getByText(organizationName)).toBeVisible();
	}

	async acceptInvitation() {
		await this.page.getByRole('button', { name: '承諾' }).click();
		await expect(this.page.getByText('管理者招待を承諾しました。')).toBeVisible();
		await expect(this.page.getByRole('button', { name: '承諾' })).toBeDisabled();
	}

	async expectUnavailableInvitation() {
		await expect(this.page.getByRole('heading', { name: '招待内容の確認' })).toBeVisible();
		await expect(this.page.getByText('表示できる招待情報がありません。')).toBeVisible();
		await expect(this.page.getByText(/Forbidden|権限|招待情報の取得に失敗/)).toBeVisible();
		await expect(this.page.getByRole('button', { name: '承諾' })).toBeDisabled();
	}
}
