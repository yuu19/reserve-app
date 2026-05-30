import { test } from '@playwright/test';
import {
	acceptInvitation,
	createAccount,
	createOwnerOrganization,
	createParticipantInvitation,
	signUpAccount,
	startPremiumTrial,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';
import { ScopedNavigationPage } from '../pages';

test.describe('スコープ付きナビゲーション', () => {
	test.setTimeout(120_000);

	test('ダッシュボード操作とサイドバーリンクで組織slugと店舗slugを維持する', async ({
		page,
		request,
		context,
		playwright
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'scoped-nav');
		const { owner, organization } = await createOwnerOrganization({ request, context, token });
		const sidebarParticipant = createAccount(token, 'participant-sidebar');
		await startPremiumTrial({ request, organization });
		const participantInvitation = await createParticipantInvitation({
			request,
			organization,
			email: owner.email,
			participantName: owner.name
		});
		await acceptInvitation({ request, invitation: participantInvitation });
		const sidebarParticipantInvitation = await createParticipantInvitation({
			request,
			organization,
			email: sidebarParticipant.email,
			participantName: sidebarParticipant.name
		});
		await syncRequestCookiesToBrowser(request, context);

		const scopedNavigation = new ScopedNavigationPage(page);
		const dashboardActions = [
			{ label: 'サービス一覧へ移動', expectedPath: '/admin/services' },
			{ label: '単発予約枠へ移動', expectedPath: '/admin/schedules/slots' },
			{ label: '定期一覧へ移動', expectedPath: '/admin/schedules/recurring' },
			{ label: '回数券管理へ移動', expectedPath: '/admin/tickets' },
			{ label: '管理者招待へ移動', expectedPath: '/admin/invitations' },
			{ label: '予約確認へ移動', expectedPath: '/participant/bookings' }
		];

		for (const action of dashboardActions) {
			await scopedNavigation.openDashboardAction({ organization, ...action });
		}

		const adminSidebarLinks = [
			{ label: 'サービス一覧', expectedPath: '/admin/services' },
			{ label: '単発予約枠', expectedPath: '/admin/schedules/slots' },
			{ label: '定期一覧', expectedPath: '/admin/schedules/recurring' },
			{ label: '回数券管理', expectedPath: '/admin/tickets' },
			{ label: '店舗招待', expectedPath: '/admin/invitations' }
		];

		for (const link of adminSidebarLinks) {
			await scopedNavigation.gotoDashboard(organization);
			await scopedNavigation.openSidebarLink({ organization, ...link });
		}

		const participantRequest = await playwright.request.newContext();
		try {
			await signUpAccount({ request: participantRequest, account: sidebarParticipant });
			await acceptInvitation({
				request: participantRequest,
				invitation: sidebarParticipantInvitation
			});
			await context.clearCookies();
			await syncRequestCookiesToBrowser(participantRequest, context);
			await scopedNavigation.gotoParticipantHome(organization);
			await scopedNavigation.openSidebarLink({
				organization,
				label: '予約確認',
				expectedPath: '/participant/bookings'
			});
		} finally {
			await participantRequest.dispose();
		}
	});
});
