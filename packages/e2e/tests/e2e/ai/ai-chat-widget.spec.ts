import { expect, test } from '@playwright/test';
import {
	createOwnerOrganization,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';
import { AiChatWidgetPage } from '../pages';

test.describe('AIチャットウィジェット', () => {
	test.setTimeout(120_000);

	test('実AIサービスを呼ばずに根拠付き回答を表示しフィードバックを記録する', async ({
		page,
		request,
		context
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'ai-chat');
		const { organization } = await createOwnerOrganization({ request, context, token });
		await syncRequestCookiesToBrowser(request, context);
		const aiChatWidget = new AiChatWidgetPage(page);

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
					answer: '単発予約枠作成から予約枠を作成できます。操作は実行せず、作成画面を案内します。',
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
							label: '単発予約枠作成を開く',
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

		await aiChatWidget.gotoDashboard(organization);
		await aiChatWidget.ask('予約枠を作るには？');

		await aiChatWidget.expectGroundedAnswer();
		await aiChatWidget.markHelpful();
		await aiChatWidget.followSuggestedAction({
			organization,
			label: '単発予約枠作成を開く',
			expectedPath: '/admin/schedules/slots/new'
		});
	});

	test('実AIサービスを呼ばずにAPIエラーを表示する', async ({
		page,
		request,
		context
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'ai-error');
		const { organization } = await createOwnerOrganization({ request, context, token });
		await syncRequestCookiesToBrowser(request, context);
		const aiChatWidget = new AiChatWidgetPage(page);

		await page.route('**/api/v1/ai/chat', async (route) => {
			await route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({
					message: 'AI応答の生成に失敗しました。'
				})
			});
		});

		await aiChatWidget.gotoDashboard(organization);
		await aiChatWidget.ask('エラー表示を確認したい');

		await aiChatWidget.expectErrorMessage('AI応答の生成に失敗しました。');
	});

	test('レート制限応答で再試行案内を表示する', async ({
		page,
		request,
		context
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'ai-rate-limit');
		const { organization } = await createOwnerOrganization({ request, context, token });
		await syncRequestCookiesToBrowser(request, context);
		const aiChatWidget = new AiChatWidgetPage(page);

		await page.route('**/api/v1/ai/chat', async (route) => {
			await route.fulfill({
				status: 429,
				contentType: 'application/json',
				body: JSON.stringify({
					message: '利用上限に達しました。',
					retryAfterSeconds: 120
				})
			});
		});

		await aiChatWidget.gotoDashboard(organization);
		await aiChatWidget.ask('利用上限の表示を確認したい');

		await aiChatWidget.expectErrorMessage('利用上限に達しました。 2分後に再試行できます。');
	});
});
