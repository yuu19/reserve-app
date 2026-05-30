import { expect, type Page } from '@playwright/test';
import type { TestOrganization, TestTicketType } from '../helpers/test-data';
import { BasePage } from './BasePage';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class TicketFlowPage extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async createTicketTypeFromAdmin({
		organization,
		name,
		totalCount,
		expiresInDays
	}: {
		organization: TestOrganization;
		name: string;
		totalCount: number;
		expiresInDays?: number;
	}) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/tickets/new`);
		await expect(this.page.getByRole('heading', { name: '回数券種別作成' })).toBeVisible();
		await this.page.getByLabel('券種名').fill(name);
		await this.page.getByRole('spinbutton', { name: '回数' }).fill(String(totalCount));
		if (expiresInDays) {
			await this.page.getByRole('spinbutton', { name: '有効日数（任意）' }).fill(String(expiresInDays));
		}
		await this.page.getByLabel('参加者が購入できるようにする').check();
		await this.page.getByRole('button', { name: '作成する' }).click();
		await expect(this.page).toHaveURL(
			new RegExp(
				`/${escapeRegex(organization.slug)}/${escapeRegex(
					organization.storeSlug
				)}/admin/tickets$`
			)
		);
		await expect(this.page.getByText(name, { exact: true })).toBeVisible();
	}

	async openPublicTicketDetail({
		organization,
		ticketType
	}: {
		organization: TestOrganization;
		ticketType: TestTicketType;
	}) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}`);
		await expect(this.page.getByRole('heading', { name: '回数券' })).toBeVisible();
		await this.page.locator('a').filter({ hasText: ticketType.name }).first().click();
		await expect(this.page).toHaveURL(
			new RegExp(
				`/${escapeRegex(organization.slug)}/${escapeRegex(
					organization.storeSlug
				)}/tickets/${escapeRegex(ticketType.id)}$`
			)
		);
		await expect(this.page.getByRole('heading', { name: '回数券詳細' })).toBeVisible();
		await expect(this.page.getByText(ticketType.name, { exact: true })).toBeVisible();
	}

	async expectLoggedOutPurchaseCta() {
		const loginLink = this.page.getByRole('link', { name: 'ログインして購入申請' });
		await expect(loginLink).toBeVisible();
		await expect(loginLink).toHaveAttribute('href', /\/participant\/login/);
	}

	async expectLoggedInPurchaseCta({
		organization,
		ticketType
	}: {
		organization: TestOrganization;
		ticketType: TestTicketType;
	}) {
		const purchaseLink = this.page.getByRole('link', { name: '購入申請へ進む' });
		await expect(purchaseLink).toBeVisible();
		await expect(purchaseLink).toHaveAttribute(
			'href',
			`/${organization.slug}/${organization.storeSlug}/participant/bookings?ticketTypeId=${ticketType.id}`
		);
	}

	async followPurchaseCta({
		organization,
		ticketType
	}: {
		organization: TestOrganization;
		ticketType: TestTicketType;
	}) {
		await this.expectLoggedInPurchaseCta({ organization, ticketType });
		await this.page.getByRole('link', { name: '購入申請へ進む' }).click();
		await expect(this.page).toHaveURL(
			`/${organization.slug}/${organization.storeSlug}/participant/bookings?ticketTypeId=${ticketType.id}`
		);
	}

	async submitPurchaseRequest(ticketType: TestTicketType) {
		await expect(this.page.getByRole('heading', { name: '予約確認' })).toBeVisible();
		await this.page
			.getByLabel('回数券種別')
			.selectOption({ label: `${ticketType.name} / ${ticketType.totalCount}回` });
		await this.page.getByRole('button', { name: '購入申請' }).click();
		await expect(this.page.getByText('回数券購入申請を受け付けました。')).toBeVisible();
		await expect(this.page.getByText('承認待ち').first()).toBeVisible();
	}

	async approvePurchaseForParticipant({
		organization,
		participantEmail
	}: {
		organization: TestOrganization;
		participantEmail: string;
	}) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/tickets`);
		await expect(this.page.getByRole('heading', { name: '回数券管理' })).toBeVisible();
		const purchaseRow = this.page.getByRole('row', {
			name: new RegExp(escapeRegex(participantEmail))
		});
		await expect(purchaseRow).toBeVisible();
		this.page.once('dialog', async (dialog) => {
			await dialog.accept();
		});
		await purchaseRow.getByRole('button', { name: '承認' }).click();
		await expect(this.page.getByText('回数券購入申請を承認しました。')).toBeVisible();
		await expect(purchaseRow).toContainText('承認済み');
	}

	async expectMyTicketPack({
		organization,
		ticketType
	}: {
		organization: TestOrganization;
		ticketType: TestTicketType;
	}) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/participant/bookings`);
		await expect(this.page.getByRole('heading', { name: '予約確認' })).toBeVisible();
		await expect(this.page.getByText('マイ回数券')).toBeVisible();
		await expect(
			this.page.getByText(`残数 ${ticketType.totalCount} / ${ticketType.totalCount}`)
		).toBeVisible();
	}
}
