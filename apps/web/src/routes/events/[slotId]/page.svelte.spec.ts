import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EventDetailPage from '$lib/pages/event-detail-page.svelte';

const mocks = vi.hoisted(() => ({
	loadPublicEventDetail: vi.fn(),
	reservePublicEvent: vi.fn(),
	createGuestPublicBooking: vi.fn(),
	loadRequiredForms: vi.fn(),
	loadSession: vi.fn(),
	redirectToLoginWithNext: vi.fn(),
	getCurrentPathWithSearch: vi.fn(() => '/org-one/room-one/events/slot-1')
}));

const pageState = vi.hoisted(() => ({
	params: {
		orgSlug: 'org-one',
		storeSlug: 'room-one',
		slotId: 'slot-1'
	} as Record<string, string | undefined>
}));

vi.mock('$app/state', () => ({
	page: pageState
}));

vi.mock('$lib/features/events.svelte', () => ({
	loadPublicEventDetail: mocks.loadPublicEventDetail,
	reservePublicEvent: mocks.reservePublicEvent,
	createGuestPublicBooking: mocks.createGuestPublicBooking
}));

vi.mock('$lib/features/forms', () => ({
	loadRequiredForms: mocks.loadRequiredForms
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession,
	redirectToLoginWithNext: mocks.redirectToLoginWithNext,
	getCurrentPathWithSearch: mocks.getCurrentPathWithSearch
}));

describe('イベント詳細ページ', () => {
	beforeEach(() => {
		pageState.params = { orgSlug: 'org-one', storeSlug: 'room-one', slotId: 'slot-1' };
		mocks.loadPublicEventDetail.mockReset();
		mocks.reservePublicEvent.mockReset();
		mocks.createGuestPublicBooking.mockReset();
		mocks.loadRequiredForms.mockReset();
		mocks.loadSession.mockReset();
		mocks.redirectToLoginWithNext.mockReset();
		mocks.getCurrentPathWithSearch.mockReset();

		mocks.loadPublicEventDetail.mockResolvedValue({
			organizationId: 'org-1',
			organizationSlug: 'org-one',
			storeId: 'room-1',
			storeSlug: 'room-one',
			serviceId: 'service-1',
			serviceName: '公開ヨガ',
			serviceDescription: '公開イベント説明',
			serviceImageUrl: null,
			serviceKind: 'single',
			bookingPolicy: 'instant',
			requiresTicket: false,
			slotId: 'slot-1',
			startAt: '2026-06-01T01:00:00.000Z',
			endAt: '2026-06-01T02:00:00.000Z',
			slotStatus: 'open',
			slotPublicStatus: 'public',
			capacity: 8,
			reservedCount: 1,
			remainingCount: 7,
			bookingOpenAt: '2026-05-01T00:00:00.000Z',
			bookingCloseAt: '2026-06-01T00:00:00.000Z',
			isBookable: true,
			staffLabel: null,
			locationLabel: '第1スタジオ',
			ticketTypes: [
				{
					id: 'ticket-all',
					name: '全サービス回数券',
					totalCount: 5,
					expiresInDays: 90,
					serviceScope: 'all',
					serviceIds: [],
					serviceNames: [],
					href: '/org-one/room-one/tickets/ticket-all'
				},
				{
					id: 'ticket-specific',
					name: 'ヨガ専用回数券',
					totalCount: 3,
					expiresInDays: null,
					serviceScope: 'specific',
					serviceIds: ['service-1'],
					serviceNames: ['公開ヨガ'],
					href: '/org-one/room-one/tickets/ticket-specific'
				},
				{
					id: 'ticket-other',
					name: '別サービス回数券',
					totalCount: 3,
					expiresInDays: null,
					serviceScope: 'specific',
					serviceIds: ['service-2'],
					serviceNames: ['別サービス'],
					href: '/org-one/room-one/tickets/ticket-other'
				}
			]
		});
		mocks.loadRequiredForms.mockResolvedValue({
			formContextHash: 'ctx_default',
			forms: []
		});
		mocks.loadSession.mockResolvedValue({
			session: null,
			status: 401
		});
	});

	it('イベント詳細の見出しと予約ボタンを表示する', async () => {
		render(EventDetailPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: 'イベント詳細' }))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '予約する' })).toBeInTheDocument();
	});

	it('スコープ付きイベント詳細からゲスト公開予約を作成する', async () => {
		pageState.params = { orgSlug: 'org-one', storeSlug: 'room-one', slotId: 'slot-1' };
		mocks.createGuestPublicBooking.mockResolvedValue({
			ok: true,
			message: '予約を受け付けました。',
			booking: {
				bookingId: 'booking-1',
				bookingPublicId: 'bk_public_1',
				status: 'confirmed'
			}
		});

		render(EventDetailPage);

		await page.getByLabelText('氏名').fill('Public Guest');
		await page.getByLabelText('メールアドレス').fill('guest@example.com');
		await page.getByLabelText('電話番号').fill('090-0000-0000');
		await page.getByLabelText('人数').fill('2');
		await page.getByLabelText('同伴者').fill('Friend One');
		await page.getByLabelText('備考').fill('窓際希望');
		await page.getByRole('button', { name: '予約する' }).click();

		await vi.waitFor(() => {
			expect(mocks.createGuestPublicBooking).toHaveBeenCalledWith(
				{ orgSlug: 'org-one', storeSlug: 'room-one' },
				{
					slotId: 'slot-1',
					customer: {
						name: 'Public Guest',
						email: 'guest@example.com',
						phone: '090-0000-0000'
					},
					serviceId: 'service-1',
					participantsCount: 2,
					companions: [{ name: 'Friend One' }],
					note: '窓際希望',
					formContextHash: 'ctx_default',
					formSubmissions: []
				}
			);
		});
		await expect.element(page.getByText('bk_public_1')).toBeInTheDocument();
	});

	it('公開予約フォームのフォーム回答を送信する', async () => {
		pageState.params = { orgSlug: 'org-one', storeSlug: 'room-one', slotId: 'slot-1' };
		mocks.loadPublicEventDetail.mockResolvedValueOnce({
			organizationId: 'org-1',
			organizationSlug: 'org-one',
			storeId: 'room-1',
			storeSlug: 'room-one',
			serviceId: 'service-1',
			serviceName: '公開ヨガ',
			serviceDescription: '公開イベント説明',
			serviceImageUrl: null,
			serviceKind: 'single',
			bookingPolicy: 'instant',
			requiresTicket: false,
			slotId: 'slot-1',
			startAt: '2026-06-01T01:00:00.000Z',
			endAt: '2026-06-01T02:00:00.000Z',
			slotStatus: 'open',
			slotPublicStatus: 'public',
			capacity: 8,
			reservedCount: 1,
			remainingCount: 7,
			bookingOpenAt: '2026-05-01T00:00:00.000Z',
			bookingCloseAt: '2026-06-01T00:00:00.000Z',
			isBookable: true,
			staffLabel: null,
			locationLabel: '第1スタジオ',
			ticketTypes: []
		});
		mocks.loadRequiredForms.mockResolvedValueOnce({
			formContextHash: 'ctx_answers',
			forms: [
				{
					formTemplateId: 'form-1',
					formTemplateVersionId: 'version-1',
					formType: 'reservation_input',
					name: '体験予約フォーム',
					description: null,
					versionNumber: 1,
					fields: [
						{
							fieldKey: 'goal',
							label: '参加目的',
							fieldType: 'text',
							required: true,
							options: [],
							description: '目的を一言で入力してください。',
							placeholder: '例: 体力づくり',
							sortOrder: 0
						},
						{
							fieldKey: 'experience',
							label: '経験年数',
							fieldType: 'select',
							required: true,
							options: [
								{ value: 'none', label: '未経験' },
								{ value: 'over_1_year', label: '1年以上' }
							],
							description: null,
							placeholder: '選択してください',
							sortOrder: 1
						},
						{
							fieldKey: 'request',
							label: '希望内容',
							fieldType: 'textarea',
							required: false,
							options: [],
							description: null,
							placeholder: null,
							sortOrder: 2
						},
						{
							fieldKey: 'newsletter',
							label: '案内メールを受け取る',
							fieldType: 'checkbox',
							required: false,
							options: [{ value: 'subscribe', label: '受け取る' }],
							description: '最新情報をメールで案内します。',
							placeholder: null,
							sortOrder: 3
						}
					]
				}
			]
		});
		mocks.createGuestPublicBooking.mockResolvedValue({
			ok: true,
			message: '予約を受け付けました。',
			booking: {
				bookingId: 'booking-1',
				bookingPublicId: 'bk_public_1',
				status: 'confirmed'
			}
		});

		render(EventDetailPage);

		await page.getByLabelText('氏名').fill('Public Guest');
		await page.getByLabelText('メールアドレス').fill('guest@example.com');
		await page.getByLabelText('人数').fill('1');
		await page.getByLabelText('参加目的 *').fill('体力づくり');
		await page.getByLabelText('経験年数 *').selectOptions('over_1_year');
		await page.getByLabelText('希望内容').fill('初回なのでゆっくり進めたい');
		await page.getByRole('checkbox', { name: /受け取る/ }).click();
		await page.getByRole('button', { name: '予約する' }).click();

		await vi.waitFor(() => {
			expect(mocks.createGuestPublicBooking).toHaveBeenCalledWith(
				{ orgSlug: 'org-one', storeSlug: 'room-one' },
				expect.objectContaining({
					formContextHash: 'ctx_answers',
					formSubmissions: [
						{
							formTemplateId: 'form-1',
							formTemplateVersionId: 'version-1',
							answers: [
								{
									fieldKey: 'goal',
									value: '体力づくり'
								},
								{
									fieldKey: 'experience',
									value: 'over_1_year'
								},
								{
									fieldKey: 'request',
									value: '初回なのでゆっくり進めたい'
								},
								{
									fieldKey: 'newsletter',
									value: ['subscribe']
								}
							]
						}
					]
				})
			);
		});
	});

	it('任意のチェック項目は未チェックを空配列として送信する', async () => {
		pageState.params = { orgSlug: 'org-one', storeSlug: 'room-one', slotId: 'slot-1' };
		mocks.loadPublicEventDetail.mockResolvedValueOnce({
			organizationId: 'org-1',
			organizationSlug: 'org-one',
			storeId: 'room-1',
			storeSlug: 'room-one',
			serviceId: 'service-1',
			serviceName: '公開ヨガ',
			serviceDescription: '公開イベント説明',
			serviceImageUrl: null,
			serviceKind: 'single',
			bookingPolicy: 'instant',
			requiresTicket: false,
			slotId: 'slot-1',
			startAt: '2026-06-01T01:00:00.000Z',
			endAt: '2026-06-01T02:00:00.000Z',
			slotStatus: 'open',
			slotPublicStatus: 'public',
			capacity: 8,
			reservedCount: 1,
			remainingCount: 7,
			bookingOpenAt: '2026-05-01T00:00:00.000Z',
			bookingCloseAt: '2026-06-01T00:00:00.000Z',
			isBookable: true,
			staffLabel: null,
			locationLabel: '第1スタジオ',
			ticketTypes: []
		});
		mocks.loadRequiredForms.mockResolvedValueOnce({
			formContextHash: 'ctx_checkbox',
			forms: [
				{
					formTemplateId: 'form-checkbox',
					formTemplateVersionId: 'version-checkbox',
					formType: 'reservation_input',
					name: '確認フォーム',
					description: null,
					versionNumber: 1,
					fields: [
						{
							fieldKey: 'newsletter',
							label: '案内メールを受け取る',
							fieldType: 'checkbox',
							required: false,
							options: [{ value: 'subscribe', label: '受け取る' }],
							description: null,
							placeholder: null,
							sortOrder: 0
						}
					]
				}
			]
		});
		mocks.createGuestPublicBooking.mockResolvedValue({
			ok: true,
			message: '予約を受け付けました。',
			booking: {
				bookingId: 'booking-1',
				bookingPublicId: 'bk_public_1',
				status: 'confirmed'
			}
		});

		render(EventDetailPage);

		await page.getByLabelText('氏名').fill('Public Guest');
		await page.getByLabelText('メールアドレス').fill('guest@example.com');
		await page.getByLabelText('人数').fill('1');
		await page.getByRole('button', { name: '予約する' }).click();

		await vi.waitFor(() => {
			expect(mocks.createGuestPublicBooking).toHaveBeenCalledWith(
				{ orgSlug: 'org-one', storeSlug: 'room-one' },
				expect.objectContaining({
					formContextHash: 'ctx_checkbox',
					formSubmissions: [
						{
							formTemplateId: 'form-checkbox',
							formTemplateVersionId: 'version-checkbox',
							answers: [
								{
									fieldKey: 'newsletter',
									value: []
								}
							]
						}
					]
				})
			);
		});
	});

	it('現在のイベントサービスで利用可能な回数券種別だけを表示する', async () => {
		render(EventDetailPage);

		await expect.element(page.getByText('全サービス回数券')).toBeInTheDocument();
		await expect.element(page.getByText('ヨガ専用回数券')).toBeInTheDocument();
		await expect.element(page.getByText('別サービス回数券')).not.toBeInTheDocument();
		const ticketLink = page.getByRole('link', { name: /ヨガ専用回数券/ }).first();
		await expect
			.element(ticketLink)
			.toHaveAttribute('href', '/org-one/room-one/tickets/ticket-specific');
	});

	it('ルートパラメータからスコープ付き公開イベント詳細を読み込む', async () => {
		pageState.params = { orgSlug: 'org2', storeSlug: 'world', slotId: 'slot-1' };
		render(EventDetailPage);

		await vi.waitFor(() => {
			expect(mocks.loadPublicEventDetail).toHaveBeenCalledWith('slot-1', {
				orgSlug: 'org2',
				storeSlug: 'world'
			});
		});
		const ticketLink = page.getByRole('link', { name: /全サービス回数券/ }).first();
		await expect
			.element(ticketLink)
			.toHaveAttribute('href', '/org-one/room-one/tickets/ticket-all');
	});

	it('このイベントに一致する回数券種別がない場合は空メッセージを表示する', async () => {
		mocks.loadPublicEventDetail.mockResolvedValueOnce({
			organizationId: 'org-1',
			organizationSlug: 'org-one',
			storeId: 'room-1',
			storeSlug: 'room-one',
			serviceId: 'service-1',
			serviceName: '公開ヨガ',
			serviceDescription: null,
			serviceImageUrl: null,
			serviceKind: 'single',
			bookingPolicy: 'instant',
			requiresTicket: true,
			slotId: 'slot-1',
			startAt: '2026-06-01T01:00:00.000Z',
			endAt: '2026-06-01T02:00:00.000Z',
			slotStatus: 'open',
			slotPublicStatus: 'public',
			capacity: 8,
			reservedCount: 1,
			remainingCount: 7,
			bookingOpenAt: '2026-05-01T00:00:00.000Z',
			bookingCloseAt: '2026-06-01T00:00:00.000Z',
			isBookable: true,
			staffLabel: null,
			locationLabel: null,
			ticketTypes: [
				{
					id: 'ticket-other',
					name: '別サービス回数券',
					totalCount: 3,
					expiresInDays: null,
					serviceScope: 'specific',
					serviceIds: ['service-2'],
					serviceNames: ['別サービス'],
					href: '/org-one/room-one/tickets/ticket-other'
				}
			]
		});
		render(EventDetailPage);

		await expect.element(page.getByText('現在購入可能な回数券はありません。')).toBeInTheDocument();
	});
});
