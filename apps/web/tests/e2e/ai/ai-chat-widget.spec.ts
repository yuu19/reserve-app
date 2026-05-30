import { expect, test } from '@playwright/test';
import {
	createOwnerOrganization,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';
import { AiChatWidgetPage } from '../pages';

test.describe('AI chat widget', () => {
	test('shows grounded answers and records feedback without calling real AI services', async ({
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
	});
});
