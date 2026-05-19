import { expect, test } from '@playwright/test';

const manuals = [
	{
		path: '/manuals/admin/getting-started',
		indexLinkName: '初回セットアップ',
		heading: '管理者向け初回セットアップ',
		expectedText: '初回セットアップ手順',
		assets: [
			'管理画面ログインの新規登録タブ',
			'初回セットアップ画面',
			'管理画面ダッシュボード'
		]
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

test.describe('user manuals', () => {
	test('links to the published manual articles from the index', async ({ page }) => {
		await page.goto('/manuals');

		await expect(
			page.getByRole('heading', { level: 1, name: 'WakuReserve ユーザーマニュアル' })
		).toBeVisible();
		await expect(page.getByRole('heading', { name: '最初に読みたいガイド' })).toBeVisible();

		for (const manual of manuals) {
			await expect(
				page.getByRole('link', { name: new RegExp(manual.indexLinkName) }).first()
			).toHaveAttribute('href', manual.path);
		}
	});

	for (const manual of manuals) {
		test(`renders ${manual.heading} with referenced assets`, async ({ page }) => {
			await page.goto(manual.path);

			await expect(page.getByRole('heading', { level: 1, name: manual.heading })).toBeVisible();
			await expect(page.getByRole('heading', { level: 2, name: manual.expectedText })).toBeVisible();
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
});
