import { expect, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * 管理者 onboarding と初期 organization 作成 flow を操作する page object。
 */
export class AdminOnboardingPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /** 未ログイン landing page の主要 CTA が表示されていることを検証する。 */
  async expectLandingPage() {
    await expect(
      this.page.getByRole('heading', { level: 1, name: /予約運用を、\s*ひとつの画面で。/ }),
    ).toBeVisible();
    await expect(
      this.page.getByRole('link', { name: '管理者としてログイン' }).first(),
    ).toBeVisible();
  }

  /** 管理者 onboarding page へ移動する。 */
  async gotoOnboarding() {
    await this.goto('/admin/onboarding');
  }

  /**
   * 初期 organization と primary store を onboarding form から作成する。
   *
   * @param input - 作成する organization と store の表示名。
   * @param input.organizationName - 初期 organization name。
   * @param input.storeName - 初期 store name。
   */
  async createInitialOrganization({
    organizationName,
    storeName,
  }: {
    organizationName: string;
    storeName: string;
  }) {
    await this.page.getByLabel('組織名').fill(organizationName);
    await this.page.getByLabel('初期店舗名').fill(storeName);
    await this.page.getByRole('button', { name: '組織と店舗を作成' }).click();
  }

  /**
   * 作成後に dashboard へ遷移し、organization と store が表示されていることを検証する。
   *
   * @param input - dashboard 上で期待する表示名。
   * @param input.organizationName - 表示される organization name。
   * @param input.storeName - 表示される store name。
   */
  async expectDashboard({
    organizationName,
    storeName,
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
