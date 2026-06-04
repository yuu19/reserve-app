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
		expect(document.querySelector('input[id^="intake-field-id-"]')).toBeNull();
		await expect.element(page.getByLabelText('項目名')).toHaveValue('経験年数');
		await expect.element(page.getByLabelText('選択肢')).toHaveValue('未経験\n1年以上');
		expect(
			Array.from(document.querySelectorAll('button')).filter((button) =>
				button.textContent?.includes('項目を追加')
			)
		).toHaveLength(2);

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

	it('追加項目のIDを自動採番して保存する', async () => {
		render(IntakeFieldsRoute);

		await page.getByRole('button', { name: '項目を追加' }).last().click();
		await page.getByLabelText('項目名').last().fill('緊急連絡先');
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
						},
						{
							fieldId: 'field_2',
							label: '緊急連絡先',
							fieldType: 'text',
							required: false,
							visibleOnPublic: true,
							options: [],
							helpText: null,
							placeholder: null
						}
					]
				}
			);
		});
	});

	it('選択式の選択肢が未入力なら保存しない', async () => {
		render(IntakeFieldsRoute);

		await page.getByLabelText('選択肢').fill('   ');
		await page.getByRole('button', { name: '保存' }).click();

		expect(mocks.updateIntakeFields).not.toHaveBeenCalled();
		expect(mocks.toastError).toHaveBeenCalledWith('経験年数の選択肢を1つ以上入力してください。');
	});

	it('公開項目だけを予約フォームプレビューに表示し、確認導線を表示する', async () => {
		mocks.loadIntakeFields.mockResolvedValueOnce({
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
				},
				{
					id: 'field-2',
					fieldId: 'internal_note',
					label: '内部メモ',
					fieldType: 'text',
					required: false,
					options: [],
					helpText: '運営だけが確認する項目です。',
					placeholder: '',
					visibleOnPublic: false,
					sortOrder: 1
				}
			]
		});

		render(IntakeFieldsRoute);

		await expect
			.element(page.getByRole('heading', { level: 2, name: '予約フォームプレビュー' }))
			.toBeInTheDocument();

		const preview = document.querySelector(
			'[role="region"][aria-labelledby="intake-preview-heading"]'
		);
		expect(preview?.textContent).toContain('経験年数');
		expect(preview?.textContent).toContain('必須');
		expect(preview?.textContent).toContain('該当するものを選択してください。');
		expect(preview?.textContent).not.toContain('内部メモ');
		expect(
			Array.from(
				document.querySelectorAll<HTMLInputElement>('input[id^="intake-field-label-"]')
			).some((input) => input.value === '内部メモ')
		).toBe(true);

		const select = preview?.querySelector('select');
		expect(select?.disabled).toBe(true);
		expect(select?.required).toBe(true);
		expect(Array.from(select?.options ?? []).map((option) => option.text)).toEqual([
			'選択してください',
			'未経験',
			'1年以上'
		]);

		await expect
			.element(page.getByRole('link', { name: '予約サイト管理へ戻る' }).first())
			.toHaveAttribute('href', '/org-one/room-a/admin/public-site');
		await expect
			.element(page.getByRole('link', { name: '予約ページ一覧を開く' }))
			.toHaveAttribute('href', '/org-one/room-a/events');
		await expect
			.element(page.getByRole('link', { name: '予約ページ一覧を開く' }))
			.toHaveAttribute('target', '_blank');
		await expect
			.element(page.getByRole('link', { name: '予約ページ一覧を開く' }))
			.toHaveAttribute('rel', 'noreferrer');
	});

	it('公開対象の項目がない場合はプレビューに空状態を表示する', async () => {
		mocks.loadIntakeFields.mockResolvedValueOnce({
			fields: [
				{
					id: 'field-1',
					fieldId: 'internal_note',
					label: '内部メモ',
					fieldType: 'text',
					required: false,
					options: [],
					helpText: '',
					placeholder: '',
					visibleOnPublic: false,
					sortOrder: 0
				}
			]
		});

		render(IntakeFieldsRoute);

		await expect
			.element(page.getByText('公開予約フォームに表示する項目はありません。'))
			.toBeInTheDocument();
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
