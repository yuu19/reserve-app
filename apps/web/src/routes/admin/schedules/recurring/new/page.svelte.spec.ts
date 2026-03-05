import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminRecurringCreatePage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/admin/schedules/recurring/new'),
	getAdminRecurringPageData: vi.fn()
}));

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
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

vi.mock('$lib/remote/admin-recurring-page.remote', () => ({
	getAdminRecurringPageData: mocks.getAdminRecurringPageData
}));

describe('/admin/schedules/recurring/new/+page.svelte', () => {
	beforeEach(() => {
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.getAdminRecurringPageData.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.getCurrentPathWithSearch.mockReturnValue('/admin/schedules/recurring/new');
		mocks.getAdminRecurringPageData.mockResolvedValue({
			activeOrganizationId: 'org-1',
			canManage: true,
			services: [],
			recurringSchedules: [],
			staffRecurringSchedules: []
		});
	});

	it('should render recurring create page', async () => {
		render(AdminRecurringCreatePage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: '定期Schedule作成' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '定期一覧へ戻る' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '定期Schedule作成' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '定期スケジュールを作成' }))
			.toBeInTheDocument();
		expect(document.body.textContent ?? '').toContain('サービスを選択してください。');
		expect(document.body.textContent ?? '').toContain('サービス*');
		expect(document.body.textContent ?? '').toContain('間隔*');
		expect(document.body.textContent ?? '').toContain('開始時刻*');
		const backButtons = Array.from(document.querySelectorAll('button')).filter(
			(button) => (button.textContent ?? '').trim() === '定期一覧へ戻る'
		);
		expect(backButtons).toHaveLength(1);

		const createSection = Array.from(document.querySelectorAll('section')).find((section) =>
			section.querySelector('h2')?.textContent?.includes('定期Schedule作成')
		);
		expect(createSection).toBeTruthy();
		expect(createSection?.className ?? '').toContain('max-w-4xl');
		expect(createSection?.querySelector('form')?.className ?? '').toContain('md:grid-cols-2');
	});
});
