import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BookingsPage from './+page.svelte';

describe('/bookings/+page.svelte', () => {
	it('should render bookings heading and schedule table tabs', async () => {
		render(BookingsPage);
		await expect.element(page.getByRole('heading', { level: 1, name: '予約' })).toBeInTheDocument();
		await expect.element(page.getByText('予約方式')).toBeInTheDocument();
		await expect.element(page.getByLabelText('回数券必須サービスにする')).toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '運営予約一覧' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: 'サービス管理' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '単発Slot管理' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '定期Schedule管理' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3, name: '例外登録' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3, name: '枠を再生成' }))
			.toBeInTheDocument();
		await expect
			.element(
				page.getByText(
					'承認待ちは「承認 / 却下」、予約確定は「運営キャンセル / No-show」を実行できます。'
				)
			)
			.toBeInTheDocument();
		await expect.element(page.getByRole('tab', { name: '参加者' })).toBeInTheDocument();
		await page.getByRole('tab', { name: '参加者' }).click();
		await expect
			.element(page.getByRole('heading', { level: 3, name: 'マイ回数券' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '予約カレンダー' }))
			.toBeInTheDocument();
		const scheduleTab = page.getByRole('tab', { name: '日程表' });
		await expect.element(scheduleTab).toBeInTheDocument();
		await scheduleTab.click();
		await expect.element(page.getByRole('button', { name: '今後の日程' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '過去の日程' })).toBeInTheDocument();
	});
});
