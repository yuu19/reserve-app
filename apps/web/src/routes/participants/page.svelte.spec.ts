import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/participants'),
	loadParticipantsPageData: vi.fn(),
	loadOrganizationBilling: vi.fn()
}));

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/state', () => ({
	page: {
		url: new URL('http://localhost/admin/participants')
	}
}));

vi.mock('$lib/features/auth-session.svelte', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/auth-session.svelte')>(
		'$lib/features/auth-session.svelte'
	);
	return {
		...actual,
		loadSession: mocks.loadSession,
		redirectToLoginWithNext: mocks.redirectToLoginWithNext,
		getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
	};
});

vi.mock('$lib/features/participants-page.svelte', () => ({
	loadParticipantsPageData: mocks.loadParticipantsPageData
}));

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizationBilling: mocks.loadOrganizationBilling
}));

describe('参加者管理ページ', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadParticipantsPageData.mockReset();
		mocks.loadOrganizationBilling.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/participants');
		mocks.loadParticipantsPageData.mockResolvedValue({
			activeContext: {
				orgSlug: 'org-1',
				storeSlug: 'room-1'
			},
			organizationId: 'org-1',
			canManage: true,
			canManageParticipants: true,
			canManageStore: true,
			premiumRestriction: null,
			participants: [],
			sentInvitations: [],
			receivedInvitations: [],
			loadError: null
		});
	});

	it('参加者の見出しを表示する', async () => {
		render(ParticipantsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '参加者管理' }))
			.toBeInTheDocument();
	});

	it('参加者ページでは回数券管理操作を表示しない', async () => {
		render(ParticipantsPage);

		await expect.element(page.getByText('参加者一覧・参加者招待を行います。')).toBeInTheDocument();
		await expect.element(page.getByText('回数券種別作成')).not.toBeInTheDocument();
		await expect.element(page.getByText('回数券付与')).not.toBeInTheDocument();
		await expect.element(page.getByText('回数券購入管理')).not.toBeInTheDocument();
		await expect.element(page.getByText('Stripe 価格ID（販売時必須）')).not.toBeInTheDocument();
	});

	it('初期読み込み中は読み込みメッセージを表示し組織必須メッセージを隠す', async () => {
		mocks.loadParticipantsPageData.mockImplementation(() => new Promise(() => {}));

		render(ParticipantsPage);

		await expect.element(page.getByText('参加者データを読み込み中…')).toBeInTheDocument();
		await expect
			.element(page.getByText('利用中の組織を `/admin/dashboard` で選択してください。'))
			.not.toBeInTheDocument();
	});

	it('読み込み後にアクティブ組織がない場合は組織必須メッセージを表示する', async () => {
		mocks.loadParticipantsPageData.mockResolvedValue({
			activeContext: null,
			organizationId: null,
			canManage: false,
			canManageParticipants: false,
			canManageStore: false,
			premiumRestriction: null,
			participants: [],
			sentInvitations: [],
			receivedInvitations: [],
			loadError: null
		});

		render(ParticipantsPage);

		await expect
			.element(page.getByText('利用中の組織を `/admin/dashboard` で選択してください。'))
			.toBeInTheDocument();
	});

	it('スタッフには回数券管理なしで参加者操作を表示する', async () => {
		mocks.loadParticipantsPageData.mockResolvedValue({
			activeContext: {
				orgSlug: 'org-1',
				storeSlug: 'room-1'
			},
			organizationId: 'org-1',
			canManage: true,
			canManageParticipants: true,
			canManageStore: false,
			premiumRestriction: null,
			participants: [
				{
					id: 'participant-1',
					organizationId: 'org-1',
					userId: 'user-1',
					name: 'Participant One',
					email: 'participant@example.com',
					createdAt: '2026-03-01T00:00:00.000Z',
					updatedAt: '2026-03-01T00:00:00.000Z'
				}
			],
			sentInvitations: [],
			receivedInvitations: [],
			loadError: null
		});

		render(ParticipantsPage);

		await expect.element(page.getByText('Participant One')).toBeInTheDocument();
		await expect.element(page.getByText('回数券付与')).not.toBeInTheDocument();
		await expect.element(page.getByText('回数券購入管理')).not.toBeInTheDocument();
	});

	it('オーナー CTA なしで読み取り専用のプレミアム制限案内を表示する', async () => {
		mocks.loadParticipantsPageData.mockResolvedValue({
			activeContext: {
				orgSlug: 'org-1',
				storeSlug: 'room-1'
			},
			organizationId: 'org-1',
			canManage: true,
			canManageParticipants: true,
			canManageStore: true,
			premiumRestriction: {
				message: 'Organization premium plan is required for this feature.',
				code: 'organization_premium_required',
				source: 'application_billing_state',
				reason: 'organization_plan_is_free',
				entitlementState: 'free_only',
				planState: 'free',
				trialEndsAt: null
			},
			participants: [],
			sentInvitations: [],
			receivedInvitations: [],
			loadError: null
		});
		mocks.loadOrganizationBilling.mockResolvedValue({
			ok: true,
			billing: {
				planCode: 'free',
				planState: 'free',
				billingInterval: null,
				paymentMethodStatus: 'not_started',
				subscriptionStatus: 'free',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: null,
				trialEndsAt: null,
				canViewBilling: true,
				canManageBilling: false
			}
		});

		render(ParticipantsPage);

		await expect
			.element(
				page.getByRole('heading', {
					level: 2,
					name: '参加者管理には Premiumプランが必要です'
				})
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByText(/契約変更と支払い設定は組織オーナーのみです/))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '契約画面を開く' }))
			.not.toBeInTheDocument();
	});
});
