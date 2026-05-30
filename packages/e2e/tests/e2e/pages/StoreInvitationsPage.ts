import { expect, type Page } from '@playwright/test';
import type { TestInvitation, TestOrganization } from '../helpers/test-data';
import { BasePage } from './BasePage';

/**
 * 店舗運営者・参加者の招待管理画面を操作する page object。
 */
export class StoreInvitationsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Scoped store invitation 管理画面へ移動する。
   *
   * @param organization - invitation 管理画面の organization / store scope。
   */
  async gotoInvitations(organization: TestOrganization) {
    await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/invitations`);
    await expect(this.page.getByRole('heading', { name: '店舗招待' })).toBeVisible();
  }

  /**
   * 店舗運営者招待 form から invitation を送信する。
   *
   * @param input - 招待先と scope。
   * @param input.organization - invitation を送る organization fixture。
   * @param input.email - 招待先 email address。
   */
  async sendStoreOperatorInvitation({
    organization,
    email,
  }: {
    organization: TestOrganization;
    email: string;
  }) {
    await this.gotoInvitations(organization);
    const form = this.page.locator('form').filter({ hasText: '店舗運営招待を送信' });
    await form.getByLabel('メールアドレス').fill(email);
    await form.getByRole('button', { name: '送信' }).click();
    await expect(this.page.getByText('店舗運営招待を送信しました。')).toBeVisible();
    await this.expectInvitationRow({ email, status: '送信中' });
  }

  /**
   * 参加者招待 form から invitation を送信する。
   *
   * @param input - 招待先 participant と scope。
   * @param input.organization - invitation を送る organization fixture。
   * @param input.email - 招待先 email address。
   * @param input.participantName - 招待する participant name。
   */
  async sendParticipantInvitation({
    organization,
    email,
    participantName,
  }: {
    organization: TestOrganization;
    email: string;
    participantName: string;
  }) {
    await this.gotoInvitations(organization);
    const form = this.page.locator('form').filter({ hasText: '参加者招待を送信' });
    await form.getByLabel('メールアドレス').fill(email);
    await form.getByLabel('参加者名').fill(participantName);
    await form.getByRole('button', { name: '送信' }).click();
    await expect(this.page.getByText('参加者招待を送信しました。')).toBeVisible();
    await this.expectInvitationRow({ email, status: '送信中' });
  }

  /**
   * Invitation row の再送 button を押し、送信中 status に戻ることを検証する。
   *
   * @param email - 再送対象 row を特定する email address。
   */
  async resendInvitation(email: string) {
    const row = this.invitationRow(email);
    await row.getByRole('button', { name: '再送' }).click();
    await expect(this.page.getByText(/招待を再送しました。/)).toBeVisible();
    await this.expectInvitationRow({ email, status: '送信中' });
  }

  /**
   * Invitation row の取り消し button を押し、取消済み status になることを検証する。
   *
   * @param email - 取り消し対象 row を特定する email address。
   */
  async cancelInvitation(email: string) {
    const row = this.invitationRow(email);
    this.page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await row.getByRole('button', { name: '取り消し' }).click();
    await expect(this.page.getByText('招待を取り消しました。')).toBeVisible();
    await this.expectInvitationRow({ email, status: '取消済み' });
  }

  /**
   * 参加者招待承諾画面で invitation を承諾する。
   *
   * @param invitation - 承諾する participant invitation fixture。
   */
  async acceptParticipantInvitation(invitation: TestInvitation) {
    await this.goto(`/participants/invitations/accept?invitationId=${invitation.id}`);
    await expect(this.page.getByRole('heading', { name: '招待内容の確認' })).toBeVisible();
    await expect(this.page.getByText('pending')).toBeVisible();
    await this.page.getByRole('button', { name: '承諾' }).click();
    await expect(this.page.getByText('参加者招待を承諾しました。')).toBeVisible();
  }

  /**
   * Invitation row に期待する status text が含まれていることを検証する。
   *
   * @param input - 検証対象 row と status。
   * @param input.email - row を特定する email address。
   * @param input.status - row 内に表示される status text。
   */
  async expectInvitationRow({ email, status }: { email: string; status: string }) {
    await expect(this.invitationRow(email)).toContainText(status);
  }

  // 招待 row は table role ではないため、email と再送 button を併用して対象 block を絞る。
  private invitationRow(email: string) {
    return this.page
      .locator('div')
      .filter({ hasText: email })
      .filter({ has: this.page.getByRole('button', { name: '再送' }) })
      .last();
  }
}
