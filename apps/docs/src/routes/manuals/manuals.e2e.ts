import { expect, test } from '@playwright/test';

const publishedManuals = [
	{
		path: '/manuals/admin/getting-started',
		indexLinkName: '初回セットアップ',
		heading: '管理者向け初回セットアップ',
		expectedText: '初回セットアップ手順',
		assets: ['管理画面ログインの新規登録タブ', '初回セットアップ画面', '管理画面ダッシュボード']
	},
	{
		path: '/manuals/admin/contracts-and-premium',
		indexLinkName: '契約と Premium',
		heading: '契約と Premium',
		expectedText: 'Premium トライアルを開始する手順',
		assets: ['契約画面', 'Premium トライアル中の契約画面', 'Premium プランの契約管理画面']
	},
	{
		path: '/manuals/common/ai-chatbot',
		indexLinkName: 'AI チャットの使い方',
		heading: 'AI チャットの使い方',
		expectedText: '処理の全体像',
		assets: ['AIチャットボットの処理の流れ']
	}
] as const;

const preparingManuals = [
	{
		path: '/manuals/admin/one-time-slots',
		indexLinkName: '単発予約枠',
		heading: '単発予約枠'
	},
	{
		path: '/manuals/admin/recurring-schedules',
		indexLinkName: '定期スケジュール',
		heading: '定期スケジュール'
	},
	{
		path: '/manuals/admin/organization-and-store',
		indexLinkName: '組織と店舗管理',
		heading: '組織と店舗管理'
	},
	{
		path: '/manuals/admin/admin-invitations',
		indexLinkName: 'スタッフ招待',
		heading: 'スタッフ招待'
	},
	{
		path: '/manuals/admin/participants-and-tickets',
		indexLinkName: '参加者管理と回数券',
		heading: '参加者管理と回数券'
	}
] as const;

test.describe('user manuals', () => {
	test('links to the manual articles from the index', async ({ page }) => {
		await page.goto('/manuals');

		await expect(
			page.getByRole('heading', { level: 1, name: 'WakuReserve ユーザーマニュアル' })
		).toBeVisible();
		await expect(page.getByRole('heading', { name: '最初に読みたいガイド' })).toBeVisible();

		for (const manual of publishedManuals) {
			await expect(
				page.getByRole('link', { name: new RegExp(manual.indexLinkName) }).first()
			).toHaveAttribute('href', manual.path);
		}

		for (const manual of preparingManuals) {
			const link = page.getByRole('link', {
				name: new RegExp(`${manual.indexLinkName}.*準備中`)
			});
			await expect(link).toHaveAttribute('href', manual.path);
		}
	});

	for (const manual of publishedManuals) {
		test(`renders ${manual.heading} with referenced assets`, async ({ page }) => {
			await page.goto(manual.path);

			await expect(page.getByRole('heading', { level: 1, name: manual.heading })).toBeVisible();
			await expect(
				page.getByRole('heading', { level: 2, name: manual.expectedText })
			).toBeVisible();
			await expect(
				page.getByLabel('パンくず').getByRole('link', {
					exact: true,
					name: 'ユーザーマニュアル'
				})
			).toBeVisible();

			for (const assetName of manual.assets) {
				const image = page.getByRole('img', { exact: true, name: assetName });
				await expect(image).toBeVisible();
				await expect
					.poll(async () =>
						image.evaluate((element) => {
							const img = element as HTMLImageElement;
							return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
						})
					)
					.toBe(true);
			}
		});
	}

	for (const manual of preparingManuals) {
		test(`renders ${manual.heading} as preparing`, async ({ page }) => {
			await page.goto(manual.path);

			await expect(page.getByRole('heading', { level: 1, name: manual.heading })).toBeVisible();
			await expect(page.getByText('このマニュアルは準備中です。')).toBeVisible();
			await expect(page.getByText('準備中').first()).toBeVisible();
			await expect(
				page.getByLabel('パンくず').getByRole('link', {
					exact: true,
					name: 'ユーザーマニュアル'
				})
			).toBeVisible();
		});
	}
});
