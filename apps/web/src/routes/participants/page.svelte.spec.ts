import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParticipantsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/participants'),
	loadParticipantsPageData: vi.fn()
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

describe('/participants/+page.svelte', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadParticipantsPageData.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/participants');
		mocks.loadParticipantsPageData.mockResolvedValue({
			activeOrganizationId: 'org-1',
			canManage: true,
			participants: [],
			sentInvitations: [],
			receivedInvitations: [],
			services: [],
			ticketTypes: [],
			ticketPurchases: []
		});
	});

	it('should render participants heading', async () => {
		render(ParticipantsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '参加者管理' }))
			.toBeInTheDocument();
	});

	it('should show loading message and hide organization-required message during initial load', async () => {
		mocks.loadParticipantsPageData.mockImplementation(() => new Promise(() => {}));

		render(ParticipantsPage);

		await expect.element(page.getByText('参加者データを読み込み中…')).toBeInTheDocument();
		await expect
			.element(page.getByText('利用中の組織を `/admin/dashboard` で選択してください。'))
			.not.toBeInTheDocument();
	});

	it('should show organization-required message after load when no active organization', async () => {
		mocks.loadParticipantsPageData.mockResolvedValue({
			activeOrganizationId: null,
			canManage: false,
			participants: [],
			sentInvitations: [],
			receivedInvitations: [],
			services: [],
			ticketTypes: [],
			ticketPurchases: []
		});

		render(ParticipantsPage);

		await expect
			.element(page.getByText('利用中の組織を `/admin/dashboard` で選択してください。'))
			.toBeInTheDocument();
	});
});
