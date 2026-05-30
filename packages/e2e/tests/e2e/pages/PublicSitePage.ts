import { expect, type Page } from '@playwright/test';
import type { TestOrganization, TestService, TestSlot, TestTicketType } from '../helpers/test-data';
import { BasePage } from './BasePage';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class PublicSitePage extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async gotoSite(organization: TestOrganization) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}`);
		await expect(this.page.getByRole('heading', { name: '予約ページ一覧' })).toBeVisible();
	}

	async expectPublicHome({
		organization,
		service,
		slot,
		ticketType
	}: {
		organization: TestOrganization;
		service: TestService;
		slot: TestSlot;
		ticketType: TestTicketType;
	}) {
		await this.gotoSite(organization);
		await expect(this.page.getByText(organization.name).first()).toBeVisible();
		const bookingPageLink = this.page.locator('a').filter({ hasText: service.name }).first();
		await expect(bookingPageLink).toHaveAttribute(
			'href',
			`/${organization.slug}/${organization.storeSlug}/events/${slot.id}`
		);
		const ticketLink = this.page.locator('a').filter({ hasText: ticketType.name }).first();
		await expect(ticketLink).toHaveAttribute(
			'href',
			`/${organization.slug}/${organization.storeSlug}/tickets/${ticketType.id}`
		);
	}

	async openTicketDetail({
		organization,
		ticketType
	}: {
		organization: TestOrganization;
		ticketType: TestTicketType;
	}) {
		await this.page.locator('a').filter({ hasText: ticketType.name }).first().click();
		await expect(this.page).toHaveURL(
			new RegExp(
				`/${escapeRegex(organization.slug)}/${escapeRegex(
					organization.storeSlug
				)}/tickets/${escapeRegex(ticketType.id)}$`
			)
		);
		await expect(this.page.getByText(ticketType.name)).toBeVisible();
	}

	async expectLoggedOutCta() {
		const cta = this.page.getByRole('link', { name: 'ログインして購入申請' });
		await expect(cta).toBeVisible();
		await expect(cta).toHaveAttribute('href', /\/participant\/login/);
	}

	async expectLoggedInCta({
		organization,
		ticketType
	}: {
		organization: TestOrganization;
		ticketType: TestTicketType;
	}) {
		const cta = this.page.getByRole('link', { name: '購入申請へ進む' });
		await expect(cta).toBeVisible();
		await expect(cta).toHaveAttribute(
			'href',
			`/${organization.slug}/${organization.storeSlug}/participant/bookings?ticketTypeId=${ticketType.id}`
		);
	}
}
