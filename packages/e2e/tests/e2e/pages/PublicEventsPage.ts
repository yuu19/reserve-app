import { expect, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class PublicEventsPage extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async gotoEvents() {
		await this.goto('/events');
		await expect(this.page.getByRole('heading', { name: '公開イベント' })).toBeVisible();
	}

	async openEventDetails({
		serviceName,
		orgSlug,
		storeSlug,
		slotId
	}: {
		serviceName: string;
		orgSlug: string;
		storeSlug: string;
		slotId: string;
	}) {
		const eventLink = this.page.getByRole('link', {
			name: new RegExp(`${escapeRegex(serviceName)}[\\s\\S]*イベント詳細へ`)
		});
		await expect(eventLink).toBeVisible({ timeout: 15_000 });
		await eventLink.click();
		await expect(this.page).toHaveURL(new RegExp(`/${orgSlug}/${storeSlug}/events/${slotId}`));
	}

	async reserveAsGuest({
		name,
		email
	}: {
		name: string;
		email: string;
	}) {
		await this.page.getByRole('textbox', { name: '氏名' }).fill(name);
		await this.page.getByRole('textbox', { name: 'メールアドレス' }).fill(email);
		await this.page.getByRole('button', { name: '予約する' }).click();
	}

	async expectParticipantLogin() {
		await expect(this.page).toHaveURL(/\/participant\/login/);
	}

	async expectReservationComplete() {
		await expect(
			this.page.getByRole('main').getByText('予約を受け付けました。')
		).toBeVisible();
	}
}

export class ScopedAdminPages extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async expectServiceVisible({
		orgSlug,
		storeSlug,
		serviceName
	}: {
		orgSlug: string;
		storeSlug: string;
		serviceName: string;
	}) {
		await this.goto(`/${orgSlug}/${storeSlug}/admin/services`);
		await expect(this.page.getByRole('heading', { name: 'サービス一覧' })).toBeVisible();
		await expect(
			this.page.getByRole('row', { name: new RegExp(escapeRegex(serviceName)) })
		).toBeVisible({ timeout: 15_000 });
	}

	async expectSlotVisible({
		orgSlug,
		storeSlug,
		serviceName,
		locationLabel
	}: {
		orgSlug: string;
		storeSlug: string;
		serviceName: string;
		locationLabel: string;
	}) {
		await this.goto(`/${orgSlug}/${storeSlug}/admin/schedules/slots`);
		await expect(this.page.getByRole('heading', { name: '単発予約枠一覧' })).toBeVisible();
		const slotRow = this.page.getByRole('row', { name: new RegExp(escapeRegex(serviceName)) });
		await expect(slotRow).toBeVisible({ timeout: 15_000 });
		await expect(slotRow).toContainText(locationLabel);
	}
}
