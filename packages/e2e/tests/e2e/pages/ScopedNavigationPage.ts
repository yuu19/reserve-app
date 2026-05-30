import { expect, type Page } from '@playwright/test';
import { expectNoScopedContextError, type TestOrganization } from '../helpers/test-data';
import { BasePage } from './BasePage';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Organization / store scope 付き navigation と role 切り替えを検証する page object。
 */
export class ScopedNavigationPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Scoped admin dashboard へ移動し、機能 menu が表示されるまで待つ。
   *
   * @param organization - admin dashboard の organization / store scope。
   */
  async gotoDashboard(organization: TestOrganization) {
    await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/dashboard`);
    await expect(this.page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
    await expect(this.page.getByRole('navigation', { name: '機能メニュー' })).toBeVisible({
      timeout: 30_000,
    });
  }

  /**
   * Dashboard action button を開き、期待する scoped path へ遷移したことを検証する。
   *
   * @param input - クリック対象と期待 path。
   * @param input.organization - scope として使う organization fixture。
   * @param input.label - dashboard action button の label。
   * @param input.expectedPath - organization / store slug の後ろに続く expected path。
   */
  async openDashboardAction({
    organization,
    label,
    expectedPath,
  }: {
    organization: TestOrganization;
    label: string;
    expectedPath: string;
  }) {
    await this.gotoDashboard(organization);
    await this.page.getByRole('button', { name: label }).click();
    await this.expectScopedPath(organization, expectedPath);
  }

  /**
   * Sidebar navigation link を開き、期待する scoped path へ遷移したことを検証する。
   *
   * @param input - クリック対象と期待 path。
   * @param input.organization - scope として使う organization fixture。
   * @param input.label - sidebar link の label。
   * @param input.expectedPath - organization / store slug の後ろに続く expected path。
   */
  async openSidebarLink({
    organization,
    label,
    expectedPath,
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

  /** Admin shell から participant portal へ切り替わることを検証する。 */
  async switchToParticipantPortal() {
    await this.page.getByRole('button', { name: '参加者へ切替' }).click();
    await expect(this.page).toHaveURL(/\/participant\/home/);
  }

  /**
   * Scoped participant home へ移動し、機能 menu が表示されるまで待つ。
   *
   * @param organization - participant home の organization / store scope。
   */
  async gotoParticipantHome(organization: TestOrganization) {
    await this.goto(`/${organization.slug}/${organization.storeSlug}/participant/home`);
    await expect(this.page.getByRole('heading', { name: '参加者ホーム' })).toBeVisible();
    await expect(this.page.getByRole('navigation', { name: '機能メニュー' })).toBeVisible({
      timeout: 30_000,
    });
  }

  /**
   * 現在の URL が organization / store scope 付き expected path と一致することを検証する。
   *
   * @param organization - 期待する organization / store scope。
   * @param expectedPath - organization / store slug の後ろに続く expected path。
   */
  async expectScopedPath(organization: TestOrganization, expectedPath: string) {
    await expect(this.page).toHaveURL(
      new RegExp(
        `/${escapeRegex(organization.slug)}/${escapeRegex(organization.storeSlug)}${escapeRegex(
          expectedPath,
        )}(?:[?#].*)?$`,
      ),
    );
    await expectNoScopedContextError(this.page);
  }
}
