import { expect, test } from '@playwright/test';
import {
	createOwnerOrganization,
	createService,
	futureSlotRange,
	startPremiumTrial,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';
import { BookingOperationsPage } from '../pages';

test.describe('プレミアム制限付きWeb機能', () => {
	test.setTimeout(120_000);

	test('トライアル開始まで回数券・店舗招待・定期スケジュール画面を制限する', async ({
		page,
		request,
		context
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'premium-gates');
		const { organization } = await createOwnerOrganization({ request, context, token });
		await syncRequestCookiesToBrowser(request, context);
		const operations = new BookingOperationsPage(page);
		const recurringServiceName = `Recurring gate service ${token}`;
		await createService({
			request,
			organization,
			name: recurringServiceName,
			kind: 'recurring'
		});

		await page.goto(`/${organization.slug}/${organization.storeSlug}/admin/tickets`);
		await expect(page.getByRole('heading', { name: '回数券管理' })).toBeVisible();
		await expect(page.getByTestId('premium-restriction-notice')).toContainText('回数券管理');

		await page.goto(`/${organization.slug}/${organization.storeSlug}/admin/invitations`);
		await expect(page.getByRole('heading', { name: '店舗招待' })).toBeVisible();
		await expect(page.getByTestId('premium-restriction-notice')).toContainText(
			'店舗招待と参加者招待管理'
		);

		await operations.expectRecurringScheduleCreationPremiumRestriction({
			organization,
			serviceName: recurringServiceName,
			startDate: futureSlotRange(1).dateInput
		});

		await startPremiumTrial({ request, organization });
		await syncRequestCookiesToBrowser(request, context);

		await page.goto(`/${organization.slug}/${organization.storeSlug}/admin/tickets`);
		await expect(page.getByRole('button', { name: '追加する' })).toBeVisible();
		await expect(page.getByTestId('premium-restriction-notice')).toHaveCount(0);

		await page.goto(`/${organization.slug}/${organization.storeSlug}/admin/invitations`);
		await expect(page.getByRole('heading', { name: '店舗運営招待を送信' })).toBeVisible();
		await expect(page.getByRole('heading', { name: '参加者招待を送信' })).toBeVisible();
		await expect(page.getByTestId('premium-restriction-notice')).toHaveCount(0);

		await page.goto(`/${organization.slug}/${organization.storeSlug}/admin/schedules/recurring/new`);
		await page.getByLabel('サービス*').click();
		await expect(page.getByRole('option', { name: recurringServiceName })).toBeVisible();
		await expect(page.getByTestId('premium-restriction-notice')).toHaveCount(0);
	});
});
