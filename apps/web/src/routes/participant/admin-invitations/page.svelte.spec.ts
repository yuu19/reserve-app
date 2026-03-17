import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/participant/admin-invitations'),
	loadReceivedOperatorInvitations: vi.fn(),
	actOperatorInvitation: vi.fn()
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
		loadSession: mocks.loadSession,
		redirectToLoginWithNext: mocks.redirectToLoginWithNext,
		getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
}));

vi.mock('$lib/features/invitations-classroom.svelte', () => ({
	loadReceivedOperatorInvitations: mocks.loadReceivedOperatorInvitations,
	actOperatorInvitation: mocks.actOperatorInvitation
}));

vi.mock('svelte-sonner', () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn()
	}
}));

const { default: ParticipantAdminInvitationsPage } = await import('./+page.svelte');

describe('/participant/admin-invitations/+page.svelte', () => {
	beforeEach(() => {
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadReceivedOperatorInvitations.mockReset();
		mocks.actOperatorInvitation.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/participant/admin-invitations');
		mocks.loadReceivedOperatorInvitations.mockResolvedValue({
			received: []
		});
		mocks.actOperatorInvitation.mockResolvedValue({
			ok: true,
			message: 'ok'
		});
	});

	it('should render participant operator invitation heading', async () => {
		render(ParticipantAdminInvitationsPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '受信した運営招待' }))
			.toBeInTheDocument();
	});
});
