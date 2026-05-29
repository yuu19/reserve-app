import { expect, type Page } from '@playwright/test';
import type { TestOrganization } from '../helpers/test-data';
import { BasePage } from './BasePage';

export class AiChatWidgetPage extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async gotoDashboard(organization: TestOrganization) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/dashboard`);
	}

	async ask(message: string) {
		await this.page.getByRole('button', { name: 'AIサポートを開く' }).click();
		const textbox = this.page.getByRole('textbox', { name: 'AIサポートへの質問' });
		const sendButton = this.page.getByRole('button', { name: 'AIサポートへ送信' });
		await expect(textbox).toBeEnabled();
		await textbox.fill(message);
		await expect(textbox).toHaveValue(message);
		await expect(sendButton).toBeEnabled();
		await sendButton.click();
	}

	async expectGroundedAnswer() {
		await expect(this.page.getByText('単発Slot作成から予約枠を作成できます。')).toBeVisible();
		await expect(this.page.getByLabel('回答の参照元')).toContainText('予約枠作成ガイド');
		await expect(this.page.getByLabel('次のアクション')).toContainText('単発Slot作成を開く');
		await expect(this.page.getByText('信頼度 86%')).toBeVisible();
	}

	async markHelpful() {
		await this.page.getByRole('button', { name: '役に立った' }).click();
		await expect(this.page.getByText('フィードバックを送信しました。')).toBeVisible();
	}
}
