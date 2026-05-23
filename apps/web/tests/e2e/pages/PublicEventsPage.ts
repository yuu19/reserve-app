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
		classroomSlug,
		slotId
	}: {
		serviceName: string;
		orgSlug: string;
		classroomSlug: string;
		slotId: string;
	}) {
		const eventCard = this.page
			.locator('article, div, section')
			.filter({ hasText: serviceName })
			.first();
		await expect(eventCard).toBeVisible({ timeout: 15_000 });
		await eventCard.getByRole('button', { name: 'イベント詳細へ' }).click();
		await expect(this.page).toHaveURL(new RegExp(`/${orgSlug}/${classroomSlug}/events/${slotId}`));
	}

	async reserveAsParticipant() {
		await this.page.getByRole('button', { name: '参加登録して予約する' }).click();
	}

	async expectParticipantLogin() {
		await expect(this.page).toHaveURL(/\/participant\/login/);
	}

	async expectReservationComplete() {
		await expect(this.page.getByText('参加登録が完了しました。')).toBeVisible();
		await expect(this.page.getByText('予約を申し込みました。')).toBeVisible();
	}
}

export class ScopedAdminPages extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async expectServiceVisible({
		orgSlug,
		classroomSlug,
		serviceName
	}: {
		orgSlug: string;
		classroomSlug: string;
		serviceName: string;
	}) {
		await this.goto(`/${orgSlug}/${classroomSlug}/admin/services`);
		await expect(this.page.getByRole('heading', { name: 'サービス一覧' })).toBeVisible();
		await expect(
			this.page.getByRole('row', { name: new RegExp(escapeRegex(serviceName)) })
		).toBeVisible({ timeout: 15_000 });
	}

	async expectSlotVisible({
		orgSlug,
		classroomSlug,
		serviceName,
		locationLabel
	}: {
		orgSlug: string;
		classroomSlug: string;
		serviceName: string;
		locationLabel: string;
	}) {
		await this.goto(`/${orgSlug}/${classroomSlug}/admin/schedules/slots`);
		await expect(this.page.getByRole('heading', { name: '単発Slot一覧' })).toBeVisible();
		const slotRow = this.page.getByRole('row', { name: new RegExp(escapeRegex(serviceName)) });
		await expect(slotRow).toBeVisible({ timeout: 15_000 });
		await expect(slotRow).toContainText(locationLabel);
	}
}
