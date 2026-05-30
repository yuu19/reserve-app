import { expect, type Page } from '@playwright/test';
import type { TestInvitation, TestOrganization } from '../helpers/test-data';
import { BasePage } from './BasePage';

export class StoreInvitationsPage extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async gotoInvitations(organization: TestOrganization) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/invitations`);
		await expect(this.page.getByRole('heading', { name: '店舗招待' })).toBeVisible();
	}

	async sendStoreOperatorInvitation({
		organization,
		email
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

	async sendParticipantInvitation({
		organization,
		email,
		participantName
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

	async resendInvitation(email: string) {
		const row = this.invitationRow(email);
		await row.getByRole('button', { name: '再送' }).click();
		await expect(this.page.getByText(/招待を再送しました。/)).toBeVisible();
		await this.expectInvitationRow({ email, status: '送信中' });
	}

	async cancelInvitation(email: string) {
		const row = this.invitationRow(email);
		this.page.once('dialog', async (dialog) => {
			await dialog.accept();
		});
		await row.getByRole('button', { name: '取り消し' }).click();
		await expect(this.page.getByText('招待を取り消しました。')).toBeVisible();
		await this.expectInvitationRow({ email, status: '取消済み' });
	}

	async acceptParticipantInvitation(invitation: TestInvitation) {
		await this.goto(`/participants/invitations/accept?invitationId=${invitation.id}`);
		await expect(this.page.getByRole('heading', { name: '招待内容の確認' })).toBeVisible();
		await expect(this.page.getByText('pending')).toBeVisible();
		await this.page.getByRole('button', { name: '承諾' }).click();
		await expect(this.page.getByText('参加者招待を承諾しました。')).toBeVisible();
	}

	async expectInvitationRow({ email, status }: { email: string; status: string }) {
		await expect(this.invitationRow(email)).toContainText(status);
	}

	private invitationRow(email: string) {
		return this.page
			.locator('div')
			.filter({ hasText: email })
			.filter({ has: this.page.getByRole('button', { name: '再送' }) })
			.last();
	}
}
