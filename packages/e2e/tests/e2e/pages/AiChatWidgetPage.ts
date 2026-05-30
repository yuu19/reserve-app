import { expect, type Page } from '@playwright/test';
import type { TestOrganization } from '../helpers/test-data';
import { BasePage } from './BasePage';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 管理 dashboard 上の AI chat widget を操作・検証する page object。
 */
export class AiChatWidgetPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Scoped admin dashboard へ移動し、AI support button が利用可能になるまで待つ。
   *
   * @param organization - dashboard の organization / store scope。
   */
  async gotoDashboard(organization: TestOrganization) {
    await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/dashboard`);
    await expect(this.page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
    await expect(this.page.getByRole('button', { name: 'AIサポートを開く' })).toBeVisible({
      timeout: 15_000,
    });
  }

  /**
   * AI chat widget を開き、質問 message を送信する。
   *
   * @param message - AI support textbox に入力する質問文。
   */
  async ask(message: string) {
    await this.page.getByRole('button', { name: 'AIサポートを開く' }).click();
    const textbox = this.page.getByRole('textbox', { name: 'AIサポートへの質問' });
    const sendButton = this.page.getByRole('button', { name: 'AIサポートへ送信' });
    await expect(textbox).toBeEnabled();
    await expect(async () => {
      await textbox.fill(message);
      await expect(textbox).toHaveValue(message);
      await expect(sendButton).toBeEnabled({ timeout: 2_000 });
      await sendButton.click({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
  }

  /** RAG answer、参照元、suggested action、confidence 表示を検証する。 */
  async expectGroundedAnswer() {
    await expect(this.page.getByText('単発予約枠作成から予約枠を作成できます。')).toBeVisible();
    await expect(this.page.getByLabel('回答の参照元')).toContainText('予約枠作成ガイド');
    await expect(this.page.getByLabel('次のアクション')).toContainText('単発予約枠作成を開く');
    await expect(this.page.getByText('信頼度 86%')).toBeVisible();
  }

  /** 直近の AI answer に helpful feedback を送信し、完了 message を検証する。 */
  async markHelpful() {
    await this.page.getByRole('button', { name: '役に立った' }).click();
    await expect(this.page.getByText('フィードバックを送信しました。')).toBeVisible();
  }

  /**
   * AI chat widget 内の error message を検証する。
   *
   * @param message - 表示を期待する error text。
   */
  async expectErrorMessage(message: string) {
    await expect(this.page.getByText(message)).toBeVisible();
  }

  /**
   * Suggested action link を開き、organization scope 付き path へ遷移したことを検証する。
   *
   * @param input - クリック対象と期待 path。
   * @param input.organization - scope に使う organization fixture。
   * @param input.label - suggested action link の label。
   * @param input.expectedPath - organization / store slug の後ろに続く expected path。
   */
  async followSuggestedAction({
    organization,
    label,
    expectedPath,
  }: {
    organization: TestOrganization;
    label: string;
    expectedPath: string;
  }) {
    await this.page.getByLabel('次のアクション').getByRole('link', { name: label }).click();
    await expect(this.page).toHaveURL(
      new RegExp(
        `/${escapeRegex(organization.slug)}/${escapeRegex(organization.storeSlug)}${escapeRegex(
          expectedPath,
        )}$`,
      ),
    );
  }
}
