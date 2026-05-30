import { expect, type Page } from '@playwright/test';
import type { TestOrganization } from '../helpers/test-data';
import { BasePage } from './BasePage';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class AiChatWidgetPage extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async gotoDashboard(organization: TestOrganization) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/dashboard`);
		await expect(this.page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
		await expect(this.page.getByRole('button', { name: 'AIサポートを開く' })).toBeVisible();
	}

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

	async expectGroundedAnswer() {
		await expect(this.page.getByText('単発予約枠作成から予約枠を作成できます。')).toBeVisible();
		await expect(this.page.getByLabel('回答の参照元')).toContainText('予約枠作成ガイド');
		await expect(this.page.getByLabel('次のアクション')).toContainText('単発予約枠作成を開く');
		await expect(this.page.getByText('信頼度 86%')).toBeVisible();
	}

	async markHelpful() {
		await this.page.getByRole('button', { name: '役に立った' }).click();
		await expect(this.page.getByText('フィードバックを送信しました。')).toBeVisible();
	}

	async expectErrorMessage(message: string) {
		await expect(this.page.getByText(message)).toBeVisible();
	}

	async followSuggestedAction({
		organization,
		label,
		expectedPath
	}: {
		organization: TestOrganization;
		label: string;
		expectedPath: string;
	}) {
		await this.page.getByLabel('次のアクション').getByRole('link', { name: label }).click();
		await expect(this.page).toHaveURL(
			new RegExp(
				`/${escapeRegex(organization.slug)}/${escapeRegex(organization.storeSlug)}${escapeRegex(
					expectedPath
				)}$`
			)
		);
	}
}
