import { expect, test } from '@playwright/test';
import {
	createOwnerOrganization,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';

test.describe('AI chat widget', () => {
	test('shows grounded answers and records feedback without calling real AI services', async ({
		page,
		request,
		context
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'ai-chat');
		const { organization } = await createOwnerOrganization({ request, context, token });
		await syncRequestCookiesToBrowser(request, context);

		await page.route('**/api/v1/ai/chat', async (route) => {
			const payload = route.request().postDataJSON() as { message?: string; currentPage?: string };
			expect(payload.message).toContain('予約枠');
			expect(payload.currentPage ?? '').toMatch(/\/admin\/dashboard$/);
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					conversationId: 'conversation-e2e',
					messageId: 'assistant-message-e2e',
					answer: '単発Slot作成から予約枠を作成できます。操作は実行せず、作成画面を案内します。',
					sources: [
						{
							sourceKind: 'docs',
							title: '予約枠作成ガイド',
							sourcePath: 'docs/manuals/admin/getting-started',
							chunkId: 'booking-slot-guide',
							visibility: 'authenticated'
						}
					],
					suggestedActions: [
						{
							label: '単発Slot作成を開く',
							href: '/admin/schedules/slots/new',
							actionKind: 'open_page'
						}
					],
					confidence: 86,
					needsHumanSupport: false,
					rateLimit: {
						userRemainingThisHour: 19,
						organizationRemainingToday: 199
					}
				})
			});
		});
		await page.route('**/api/v1/ai/messages/*/feedback', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					feedbackId: 'feedback-e2e',
					messageId: 'assistant-message-e2e',
					rating: 'helpful'
				})
			});
		});

		await page.goto(`/${organization.slug}/${organization.classroomSlug}/admin/dashboard`);
		await page.getByRole('button', { name: 'AIサポートを開く' }).click();
		await page
			.getByRole('textbox', { name: 'AIサポートへの質問' })
			.pressSequentially('予約枠を作るには？');
		const sendButton = page.getByRole('button', { name: 'AIサポートへ送信' });
		await expect(sendButton).toBeEnabled();
		await sendButton.click();

		await expect(page.getByText('単発Slot作成から予約枠を作成できます。')).toBeVisible();
		await expect(page.getByLabel('回答の参照元')).toContainText('予約枠作成ガイド');
		await expect(page.getByLabel('次のアクション')).toContainText('単発Slot作成を開く');
		await expect(page.getByText('信頼度 86%')).toBeVisible();

		await page.getByRole('button', { name: '役に立った' }).click();
		await expect(page.getByText('フィードバックを送信しました。')).toBeVisible();
	});
});
