import { expect, type Dialog, type Page } from '@playwright/test';
import type { TestOrganization } from '../helpers/test-data';
import { BasePage } from './BasePage';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class BookingOperationsPage extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async createServiceFromAdmin({
		organization,
		name,
		kind = 'single',
		bookingPolicy = 'instant'
	}: {
		organization: TestOrganization;
		name: string;
		kind?: 'single' | 'recurring';
		bookingPolicy?: 'instant' | 'approval';
	}) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/services/new`);
		await expect(this.page.getByRole('heading', { name: 'サービス作成' })).toBeVisible();
		await this.page.getByLabel('サービス名*').fill(name);
		await this.page.getByLabel('サービス説明').fill(`${name} description`);
		if (kind === 'recurring') {
			await this.selectOption('種別', '定期');
		}
		if (bookingPolicy === 'approval') {
			await this.selectOption('予約方式', '承認制');
		}
		await this.page.getByLabel('所要時間（分）*').fill('60');
		await this.page.getByLabel('定員*').fill('3');
		await this.page.getByRole('button', { name: 'サービスを作成' }).click();
		await expect(this.page.getByText('サービスを作成しました。')).toBeVisible();
		await expect(this.page).toHaveURL(
			new RegExp(
				`/${escapeRegex(organization.slug)}/${escapeRegex(
					organization.storeSlug
				)}/admin/services$`
			)
		);
		await expect(this.page.getByRole('row', { name: new RegExp(escapeRegex(name)) })).toBeVisible();
	}

	async createSlotFromAdmin({
		organization,
		serviceName,
		dateInput,
		startTime,
		endTime
	}: {
		organization: TestOrganization;
		serviceName: string;
		dateInput: string;
		startTime: string;
		endTime: string;
	}) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/schedules/slots/new`);
		await expect(this.page.getByRole('heading', { name: '単発予約枠作成' })).toBeVisible();
		await this.selectOption('サービス*', serviceName);
		await this.selectDate({
			triggerId: 'slot-date',
			inputName: 'slot_date',
			dateInput
		});
		await this.page.getByLabel('開始時刻*').fill(startTime);
		await this.page.getByLabel('終了時刻*').fill(endTime);
		await this.page.getByRole('button', { name: '単発予約枠を作成' }).click();
		await expect(this.page.getByText('単発枠を作成しました。')).toBeVisible();
		await expect(this.page).toHaveURL(
			new RegExp(
				`/${escapeRegex(organization.slug)}/${escapeRegex(
					organization.storeSlug
				)}/admin/schedules/slots$`
			)
		);
		await expect(
			this.page.getByRole('row', { name: new RegExp(escapeRegex(serviceName)) })
		).toBeVisible();
	}

	async createRecurringScheduleFromAdmin({
		organization,
		serviceName,
		startDate,
		endDate
	}: {
		organization: TestOrganization;
		serviceName: string;
		startDate: string;
		endDate?: string;
	}) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/schedules/recurring/new`);
		await expect(this.page.getByRole('heading', { name: '定期Schedule作成' })).toBeVisible();
		await this.selectOption('サービス*', serviceName);
		await this.selectDate({
			triggerId: 'rec-start-date',
			inputName: 'rec_start_date',
			dateInput: startDate
		});
		if (endDate) {
			await this.selectDate({
				triggerId: 'rec-end-date',
				inputName: 'rec_end_date',
				dateInput: endDate
			});
		}
		await this.page.getByLabel('開始時刻*').fill('10:00');
		await this.page.getByRole('button', { name: '定期スケジュールを作成' }).click();
		await expect(this.page.getByText('定期スケジュールを作成しました。')).toBeVisible();
		await expect(this.page).toHaveURL(
			new RegExp(
				`/${escapeRegex(organization.slug)}/${escapeRegex(
					organization.storeSlug
				)}/admin/schedules/recurring$`
			)
		);
		await expect(
			this.page.getByRole('row', { name: new RegExp(escapeRegex(serviceName)) })
		).toBeVisible();
	}

	async expectRecurringScheduleCreationPremiumRestriction({
		organization,
		serviceName,
		startDate
	}: {
		organization: TestOrganization;
		serviceName: string;
		startDate: string;
	}) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/schedules/recurring/new`);
		await expect(this.page.getByRole('heading', { name: '定期Schedule作成' })).toBeVisible();
		await this.selectOption('サービス*', serviceName);
		await this.selectDate({
			triggerId: 'rec-start-date',
			inputName: 'rec_start_date',
			dateInput: startDate
		});
		await this.page.getByRole('button', { name: '定期スケジュールを作成' }).click();
		await expect(this.page.getByText('この機能は組織のPremiumプランで利用できます。')).toBeVisible();
	}

	async applyForApprovalBooking({
		organization,
		slotLabel
	}: {
		organization: TestOrganization;
		slotLabel: string;
	}) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/participant/bookings`);
		await expect(this.page.getByRole('heading', { name: '予約確認' })).toBeVisible();
		await expect(this.page.getByText(slotLabel).first()).toBeVisible();
		await this.page.getByRole('button', { name: '申し込む' }).first().click();
		await expect(this.page.getByText('予約申請を受け付けました。')).toBeVisible();
	}

	async approveBookingFromAdmin({
		organization,
		participantEmail
	}: {
		organization: TestOrganization;
		participantEmail: string;
	}) {
		await this.goto(`/${organization.slug}/${organization.storeSlug}/admin/bookings`);
		await expect(this.page.getByRole('heading', { name: '予約管理' })).toBeVisible();
		const row = this.bookingRow(participantEmail);
		await expect(row).toBeVisible();
		this.page.once('dialog', async (dialog) => {
			await dialog.accept();
		});
		await row.getByRole('button', { name: '承認' }).click();
		await expect(this.page.getByText('予約を承認しました。')).toBeVisible();
		await expect(row).toContainText('予約確定');
	}

	async cancelApprovedBookingFromAdmin(participantEmail: string) {
		const row = this.bookingRow(participantEmail);
		await expect(row).toBeVisible();
		const dialogHandler = async (dialog: Dialog) => {
			if (dialog.type() === 'prompt') {
				await dialog.accept('E2E cancellation');
				return;
			}
			await dialog.accept();
		};
		this.page.on('dialog', dialogHandler);
		try {
			await row.getByRole('button', { name: '運営キャンセル' }).click();
			await expect(this.page.getByText('予約を運営キャンセルしました。')).toBeVisible();
			await expect(row).toContainText('運営キャンセル');
		} finally {
			this.page.off('dialog', dialogHandler);
		}
	}

	private async selectOption(label: string, optionName: string) {
		await this.page.getByLabel(label).click();
		const option = this.page.getByRole('option', { name: optionName, exact: true });
		if ((await option.count()) > 0) {
			await option.first().click();
			return;
		}
		await this.page.getByText(optionName, { exact: true }).last().click();
	}

	private async selectDate({
		triggerId,
		inputName,
		dateInput
	}: {
		triggerId: string;
		inputName: string;
		dateInput: string;
	}) {
		await this.page.locator(`#${triggerId}`).click();
		const calendar = this.page.locator('[data-slot="popover-content"]').last();
		await expect(calendar).toBeVisible();

		let dayButton = calendar
			.locator(`[data-bits-day][data-value="${dateInput}"]:not([data-disabled])`)
			.first();
		if (!(await dayButton.isVisible().catch(() => false))) {
			const targetMonthLabel = `${Number(dateInput.slice(0, 4))}年${Number(
				dateInput.slice(5, 7)
			)}月`;
			for (let attempt = 0; attempt < 24; attempt += 1) {
				if ((await calendar.getByText(targetMonthLabel, { exact: true }).count()) > 0) {
					break;
				}
				await calendar.getByRole('button', { name: 'Next' }).click();
			}
			await expect(calendar.getByText(targetMonthLabel, { exact: true })).toBeVisible();
			dayButton = calendar
				.locator(`[data-bits-day][data-value="${dateInput}"]:not([data-disabled])`)
				.first();
		}
		await dayButton.click();
		await expect(this.page.locator(`input[name="${inputName}"]`)).toHaveValue(dateInput);
	}

	private bookingRow(participantEmail: string) {
		return this.page.getByRole('row', { name: new RegExp(escapeRegex(participantEmail)) });
	}
}
