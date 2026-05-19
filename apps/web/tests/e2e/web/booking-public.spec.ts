import { expect, test } from '@playwright/test';
import {
	createAccount,
	createOwnerOrganization,
	createService,
	createSlot,
	futureSlotRange,
	publicEventsClassroomSlug,
	publicEventsOrgSlug,
	signUpAccount,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.describe('booking and public event flows', () => {
	test('shows seeded services and slots in scoped admin pages', async ({
		page,
		request,
		context
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'admin-booking');
		const { organization } = await createOwnerOrganization({ request, context, token });
		const service = await createService({
			request,
			organization,
			name: `Service ${token}`
		});
		const slotRange = futureSlotRange();
		await createSlot({
			request,
			organization,
			service,
			startAt: slotRange.startAt,
			endAt: slotRange.endAt
		});
		await syncRequestCookiesToBrowser(request, context);

		await page.goto(`/${organization.slug}/${organization.classroomSlug}/admin/services`);
		await expect(page.getByRole('heading', { name: 'サービス一覧' })).toBeVisible();
		await expect(
			page.getByRole('row', { name: new RegExp(escapeRegex(service.name)) })
		).toBeVisible({ timeout: 15_000 });

		await page.goto(`/${organization.slug}/${organization.classroomSlug}/admin/schedules/slots`);
		await expect(page.getByRole('heading', { name: '単発Slot一覧' })).toBeVisible();
		const slotRow = page.getByRole('row', { name: new RegExp(escapeRegex(service.name)) });
		await expect(slotRow).toBeVisible({ timeout: 15_000 });
		await expect(slotRow).toContainText('E2E Room');
	});

	test('lets a participant sign up and reserve a public event', async ({
		page,
		request,
		context,
		playwright
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'public-booking');
		const participant = createAccount(token, 'participant');
		const { organization } = await createOwnerOrganization({
			request,
			token,
			slug: publicEventsOrgSlug,
			classroomSlug: publicEventsClassroomSlug
		});
		const service = await createService({
			request,
			organization,
			name: `Public Event ${token}`
		});
		const slotRange = futureSlotRange();
		const slot = await createSlot({
			request,
			organization,
			service,
			startAt: slotRange.startAt,
			endAt: slotRange.endAt
		});

		await page.goto('/events');
		await expect(page.getByRole('heading', { name: '公開イベント' })).toBeVisible();
		const eventCard = page.locator('article, div, section').filter({ hasText: service.name }).first();
		await expect(eventCard).toBeVisible({ timeout: 15_000 });
		await eventCard.getByRole('button', { name: 'イベント詳細へ' }).click();
		await expect(page).toHaveURL(
			new RegExp(`/${publicEventsOrgSlug}/${publicEventsClassroomSlug}/events/${slot.id}`)
		);

		await page.getByRole('button', { name: '参加登録して予約する' }).click();
		await expect(page).toHaveURL(/\/participant\/login/);

		const participantRequest = await playwright.request.newContext();
		try {
			await signUpAccount({ request: participantRequest, account: participant });
			await syncRequestCookiesToBrowser(participantRequest, context);
		} finally {
			await participantRequest.dispose();
		}
		await page.goto('/events');

		const signedInEventCard = page
			.locator('article, div, section')
			.filter({ hasText: service.name })
			.first();
		await expect(signedInEventCard).toBeVisible({ timeout: 15_000 });
		await signedInEventCard.getByRole('button', { name: 'イベント詳細へ' }).click();
		await expect(page).toHaveURL(
			new RegExp(`/${publicEventsOrgSlug}/${publicEventsClassroomSlug}/events/${slot.id}`)
		);
		await page.getByRole('button', { name: '参加登録して予約する' }).click();

		await expect(page.getByText('参加登録が完了しました。')).toBeVisible();
		await expect(page.getByText('予約を申し込みました。')).toBeVisible();
		await expect(page.getByText('残枠: 2 / 3')).toBeVisible();
	});
});
