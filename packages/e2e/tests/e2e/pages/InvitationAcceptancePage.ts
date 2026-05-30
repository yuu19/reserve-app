import { expect, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * 管理者向け organization invitation の承諾画面を操作する page object。
 */
export class InvitationAcceptancePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Invitation id を query parameter に持つ承諾画面へ移動する。
   *
   * @param invitationId - 承諾対象の invitation id。
   */
  async gotoInvitation(invitationId: string) {
    await this.goto(`/invitations/accept?invitationId=${encodeURIComponent(invitationId)}`);
  }

  /** 未ログイン状態で admin login へ redirect されることを検証する。 */
  async expectRedirectedToAdminLogin() {
    await expect(this.page).toHaveURL(/\/admin\/login/, { timeout: 15_000 });
  }

  /**
   * 招待内容確認画面に organization name が表示されていることを検証する。
   *
   * @param organizationName - 招待元として表示される organization name。
   */
  async expectInvitationDetails(organizationName: string) {
    await expect(this.page).toHaveURL(/\/invitations\/accept/);
    await expect(this.page.getByRole('heading', { name: '招待内容の確認' })).toBeVisible();
    await expect(this.page.getByText(organizationName)).toBeVisible();
  }

  /** 表示中の invitation を承諾し、button が disabled になることを検証する。 */
  async acceptInvitation() {
    await this.page.getByRole('button', { name: '承諾' }).click();
    await expect(this.page.getByText('管理者招待を承諾しました。')).toBeVisible();
    await expect(this.page.getByRole('button', { name: '承諾' })).toBeDisabled();
  }

  /** 権限不足または無効な invitation が承諾不能として表示されることを検証する。 */
  async expectUnavailableInvitation() {
    await expect(this.page.getByRole('heading', { name: '招待内容の確認' })).toBeVisible();
    await expect(this.page.getByText('表示できる招待情報がありません。')).toBeVisible();
    await expect(this.page.getByText(/Forbidden|権限|招待情報の取得に失敗/)).toBeVisible();
    await expect(this.page.getByRole('button', { name: '承諾' })).toBeDisabled();
  }
}
