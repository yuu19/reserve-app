import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import IntakeFieldsRoute from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/org-one/room-a/admin/intake-fields'),
	loadIntakeFields: vi.fn(),
	updateIntakeFields: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	url: new URL('https://example.com/org-one/room-a/admin/intake-fields')
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
	resolve: (value: string) => value
}));

vi.mock('$app/state', () => ({
	page: pageState
}));

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_BACKEND_URL: 'http://localhost:3000'
	}
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession,
	loadPortalAccess: mocks.loadPortalAccess,
	resolvePortalHomePath: mocks.resolvePortalHomePath,
	redirectToLoginWithNext: mocks.redirectToLoginWithNext,
	getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
}));

vi.mock('$lib/features/intake-fields', () => ({
	loadIntakeFields: mocks.loadIntakeFields,
	updateIntakeFields: mocks.updateIntakeFields
}));

vi.mock('svelte-sonner', () => ({
	toast: {
		error: mocks.toastError,
		success: mocks.toastSuccess
	}
}));

describe('カスタム入力ページ', () => {
	beforeEach(() => {
		pageState.url = new URL('https://example.com/org-one/room-a/admin/intake-fields');
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadIntakeFields.mockReset();
		mocks.updateIntakeFields.mockReset();
		mocks.toastError.mockReset();
		mocks.toastSuccess.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			canManageStore: true,
			activeContext: {
				orgSlug: 'org-one',
				storeSlug: 'room-a'
			}
		});
		mocks.resolvePortalHomePath.mockReturnValue('/admin/bookings');
		mocks.getCurrentPathWithSearch.mockReturnValue('/org-one/room-a/admin/intake-fields');
		mocks.loadIntakeFields.mockResolvedValue({
			fields: [
				{
					id: 'field-1',
					fieldId: 'experience',
					label: '経験年数',
					fieldType: 'select',
					required: true,
					options: ['未経験', '1年以上'],
					helpText: '該当するものを選択してください。',
					placeholder: '選択してください',
					visibleOnPublic: true,
					sortOrder: 0
				}
			]
		});
		mocks.updateIntakeFields.mockResolvedValue({
			ok: true,
			status: 200,
			message: 'カスタム入力を保存しました。',
			fields: {
				fields: [
					{
						id: 'field-1',
						fieldId: 'experience',
						label: '経験年数',
						fieldType: 'select',
						required: true,
						options: ['未経験', '1年以上'],
						helpText: '該当するものを選択してください。',
						placeholder: '選択してください',
						visibleOnPublic: true,
						sortOrder: 0
					}
				]
			}
		});
	});

	it('スコープ付きカスタム入力を表示して保存する', async () => {
		render(IntakeFieldsRoute);

		await expect
			.element(page.getByRole('heading', { level: 1, name: 'カスタム入力' }))
			.toBeInTheDocument();
		await expect.element(page.getByLabelText('項目ID')).toHaveValue('experience');
		await expect.element(page.getByLabelText('項目名')).toHaveValue('経験年数');
		await expect.element(page.getByLabelText('選択肢')).toHaveValue('未経験\n1年以上');

		await page.getByRole('button', { name: '保存' }).click();

		await vi.waitFor(() => {
			expect(mocks.updateIntakeFields).toHaveBeenCalledWith(
				{ orgSlug: 'org-one', storeSlug: 'room-a' },
				{
					fields: [
						{
							fieldId: 'experience',
							label: '経験年数',
							fieldType: 'select',
							required: true,
							visibleOnPublic: true,
							options: ['未経験', '1年以上'],
							helpText: '該当するものを選択してください。',
							placeholder: '選択してください'
						}
					]
				}
			);
		});
		expect(mocks.toastSuccess).toHaveBeenCalledWith('カスタム入力を保存しました。');
	});

	it('選択式の選択肢が未入力なら保存しない', async () => {
		render(IntakeFieldsRoute);

		await page.getByLabelText('選択肢').fill('   ');
		await page.getByRole('button', { name: '保存' }).click();

		expect(mocks.updateIntakeFields).not.toHaveBeenCalled();
		expect(mocks.toastError).toHaveBeenCalledWith('経験年数の選択肢を1つ以上入力してください。');
	});

	it('非スコープ管理ルートでは利用中店舗のカスタム入力を取得する', async () => {
		pageState.url = new URL('https://example.com/admin/intake-fields');

		render(IntakeFieldsRoute);

		await vi.waitFor(() => {
			expect(mocks.loadIntakeFields).toHaveBeenCalledWith({
				orgSlug: 'org-one',
				storeSlug: 'room-a'
			});
		});
	});
});
