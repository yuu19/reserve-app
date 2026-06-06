import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FormsPage from './+page.svelte';
import type { FormPayload } from '$lib/rpc-client';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	resolvePortalHomePath: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/hoge/room-one/admin/forms'),
	loadForms: vi.fn(),
	loadForm: vi.fn(),
	createForm: vi.fn(),
	updateForm: vi.fn(),
	publishForm: vi.fn(),
	archiveForm: vi.fn(),
	createFormAssignment: vi.fn(),
	deleteFormAssignment: vi.fn(),
	loadFormSubmissions: vi.fn(),
	loadFormSubmissionDetail: vi.fn()
}));

const pageState = vi.hoisted(() => ({
	url: new URL('https://example.com/hoge/room-one/admin/forms'),
	params: {} as Record<string, string>
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
	getCurrentPathWithSearch: mocks.getCurrentPathWithSearch,
	parseResponseBody: vi.fn()
}));

vi.mock('$lib/features/forms', () => ({
	loadForms: mocks.loadForms,
	loadForm: mocks.loadForm,
	createForm: mocks.createForm,
	updateForm: mocks.updateForm,
	publishForm: mocks.publishForm,
	archiveForm: mocks.archiveForm,
	createFormAssignment: mocks.createFormAssignment,
	deleteFormAssignment: mocks.deleteFormAssignment,
	loadFormSubmissions: mocks.loadFormSubmissions,
	loadFormSubmissionDetail: mocks.loadFormSubmissionDetail
}));

const reservationForm: FormPayload = {
	id: 'form-reservation',
	organizationId: 'org-1',
	storeId: 'store-1',
	formType: 'reservation_input',
	name: '予約フォームの追加項目',
	description: '公開予約フォームの標準項目の後に表示する追加質問です。',
	status: 'published',
	currentPublishedVersionId: 'version-1',
	currentPublishedVersion: {
		id: 'version-1',
		versionNumber: 2,
		publishedAt: '2026-06-01T00:00:00.000Z'
	},
	fields: [
		{
			id: 'field-experience',
			fieldKey: 'experience',
			fieldType: 'radio',
			label: '経験有無',
			description: '過去の利用経験を選択してください。',
			placeholder: null,
			required: true,
			options: [
				{ value: '初めて', label: '初めて' },
				{ value: '経験あり', label: '経験あり' }
			],
			sortOrder: 0
		}
	],
	assignments: [
		{
			id: 'assignment-store',
			formType: 'reservation_input',
			targetType: 'store',
			targetId: 'store-1',
			formTemplateId: 'form-reservation',
			createdAt: '2026-06-01T00:00:00.000Z',
			updatedAt: '2026-06-01T00:00:00.000Z'
		}
	],
	createdAt: '2026-06-01T00:00:00.000Z',
	updatedAt: '2026-06-02T00:00:00.000Z',
	archivedAt: null
};

const preSurveyForm: FormPayload = {
	...reservationForm,
	id: 'form-pre-survey',
	formType: 'pre_survey',
	name: '事前アンケート',
	description: '予約前に確認したい質問を設定します。',
	status: 'draft',
	currentPublishedVersionId: null,
	currentPublishedVersion: null,
	fields: [
		{
			id: 'field-condition',
			fieldKey: 'condition',
			fieldType: 'textarea',
			label: '当日の体調',
			description: '気になることがあれば記入してください。',
			placeholder: '体調や注意点',
			required: false,
			options: [],
			sortOrder: 0
		}
	],
	assignments: [
		{
			id: 'assignment-pre-survey',
			formType: 'pre_survey',
			targetType: 'store',
			targetId: 'store-1',
			formTemplateId: 'form-pre-survey',
			createdAt: '2026-06-01T00:00:00.000Z',
			updatedAt: '2026-06-01T00:00:00.000Z'
		}
	]
};

const consentForm: FormPayload = {
	...reservationForm,
	id: 'form-consent',
	formType: 'consent',
	name: '同意事項',
	description: '予約前に同意してもらう内容を設定します。',
	status: 'draft',
	currentPublishedVersionId: null,
	currentPublishedVersion: null,
	fields: [
		{
			id: 'field-policy',
			fieldKey: 'policy',
			fieldType: 'consent',
			label: 'キャンセルポリシーに同意する',
			description: '前日以降のキャンセル料に同意してください。',
			placeholder: null,
			required: true,
			options: [],
			sortOrder: 0
		}
	],
	assignments: [
		{
			id: 'assignment-consent',
			formType: 'consent',
			targetType: 'store',
			targetId: 'store-1',
			formTemplateId: 'form-consent',
			createdAt: '2026-06-01T00:00:00.000Z',
			updatedAt: '2026-06-01T00:00:00.000Z'
		}
	]
};

describe('フォーム管理ページ', () => {
	beforeEach(() => {
		pageState.url = new URL('https://example.com/hoge/room-one/admin/forms');
		pageState.params = {};
		mocks.goto.mockReset();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.resolvePortalHomePath.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();
		mocks.loadForms.mockReset();
		mocks.loadForm.mockReset();
		mocks.createForm.mockReset();
		mocks.updateForm.mockReset();
		mocks.publishForm.mockReset();
		mocks.archiveForm.mockReset();
		mocks.createFormAssignment.mockReset();
		mocks.deleteFormAssignment.mockReset();
		mocks.loadFormSubmissions.mockReset();
		mocks.loadFormSubmissionDetail.mockReset();

		mocks.loadSession.mockResolvedValue({
			session: { user: { id: 'user-1' }, session: { id: 'session-1' } },
			status: 200
		});
		mocks.loadPortalAccess.mockResolvedValue({
			canManageStore: true,
			activeContext: { orgSlug: 'hoge', storeSlug: 'room-one' }
		});
		mocks.resolvePortalHomePath.mockReturnValue('/admin/dashboard');
		mocks.getCurrentPathWithSearch.mockReturnValue('/hoge/room-one/admin/forms');
		mocks.loadForms.mockResolvedValue({ forms: [reservationForm] });
		mocks.loadForm.mockResolvedValue(reservationForm);
	});

	it('3つの固定枠から予約フォーム設定を編集できる', async () => {
		render(FormsPage);

		await expect
			.element(page.getByRole('heading', { level: 1, name: 'フォーム管理' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '予約フォーム設定' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '事前アンケート' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '同意事項' }))
			.toBeInTheDocument();
		await expect.element(page.getByText(/^この店舗のすべての予約に表示$/u)).toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: '予約フォーム設定を編集' }))
			.toHaveAttribute('href', '/hoge/room-one/admin/forms/form-reservation');
		expect(page.getByRole('link', { name: '新規フォーム' }).query()).toBeNull();
	});

	it('未作成の固定枠は種別付き作成リンクを表示する', async () => {
		mocks.loadForms.mockResolvedValue({ forms: [] });

		render(FormsPage);

		await expect
			.element(page.getByRole('link', { name: '事前アンケートを作成' }))
			.toHaveAttribute('href', '/hoge/room-one/admin/forms/new?type=pre_survey');
		await expect
			.element(page.getByRole('link', { name: '同意事項を作成' }))
			.toHaveAttribute('href', '/hoge/room-one/admin/forms/new?type=consent');
	});

	it('予約フォーム設定の編集画面で標準項目と公開予約フォーム風プレビューを表示する', async () => {
		pageState.url = new URL('https://example.com/hoge/room-one/admin/forms/form-reservation');
		pageState.params = { formId: 'form-reservation' };

		render(FormsPage);

		await expect
			.element(page.getByRole('heading', { level: 2, name: '予約フォーム設定' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3, name: 'デフォルト項目' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3, name: 'カスタム項目' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 2, name: '予約フォームのプレビュー' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3, name: '予約者情報' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3, name: '追加質問' }))
			.toBeInTheDocument();
		await expect.element(page.getByLabelText('ラベル')).toHaveValue('経験有無');
		await expect.element(page.getByLabelText('選択肢 1')).toHaveValue('初めて');
		await expect.element(page.getByLabelText('選択肢 2')).toHaveValue('経験あり');
		expect(document.querySelector('#form-field-options-0')).toBeNull();
	});

	it('事前アンケートの編集プレビューでは予約者情報を表示しない', async () => {
		pageState.url = new URL('https://example.com/hoge/room-one/admin/forms/form-pre-survey');
		pageState.params = { formId: 'form-pre-survey' };
		mocks.loadForm.mockResolvedValue(preSurveyForm);

		render(FormsPage);

		await expect
			.element(page.getByRole('heading', { level: 2, name: '事前アンケートのプレビュー' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3, name: '事前アンケート' }))
			.toBeInTheDocument();
		await expect.element(page.getByLabelText('ラベル')).toHaveValue('当日の体調');
		expect(page.getByRole('heading', { level: 3, name: '予約者情報' }).query()).toBeNull();
		expect(document.body.textContent).not.toContain('氏名 *');
		expect(document.body.textContent).not.toContain('メールアドレス *');
		expect(document.body.textContent).not.toContain('電話番号');
		expect(document.body.textContent).not.toContain('人数 *');
		expect(document.body.textContent).not.toContain('同伴者名');
		expect(document.body.textContent).not.toContain('備考');
	});

	it('同意事項の編集プレビューでは予約者情報を表示しない', async () => {
		pageState.url = new URL('https://example.com/hoge/room-one/admin/forms/form-consent');
		pageState.params = { formId: 'form-consent' };
		mocks.loadForm.mockResolvedValue(consentForm);

		render(FormsPage);

		await expect
			.element(page.getByRole('heading', { level: 2, name: '同意事項のプレビュー' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3, name: '同意事項' }))
			.toBeInTheDocument();
		await expect.element(page.getByLabelText('ラベル')).toHaveValue('キャンセルポリシーに同意する');
		expect(page.getByRole('heading', { level: 3, name: '予約者情報' }).query()).toBeNull();
		expect(document.body.textContent).not.toContain('氏名 *');
		expect(document.body.textContent).not.toContain('メールアドレス *');
		expect(document.body.textContent).not.toContain('電話番号');
		expect(document.body.textContent).not.toContain('人数 *');
		expect(document.body.textContent).not.toContain('同伴者名');
		expect(document.body.textContent).not.toContain('備考');
	});
});
